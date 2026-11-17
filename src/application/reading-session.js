import { pageContent } from '../domain/page-content.js';
import { referenceSources } from '../domain/references.js';
import { decideEvidence, finalizeEvidence } from '../domain/evidence.js';
import { retrieveSources } from '../domain/retrieval.js';
import { composeRequest } from '../domain/prompt.js';
import { parseAnswer, streamingAnswerPreview } from '../domain/answer.js';
import { errorFeedback, ReadingError } from '../domain/errors.js';
import { clone } from '../domain/immutable.js';
import { modelCapabilities } from '../domain/configuration.js';
import { awaitWithSignal } from './cancellation.js';

export class ReadingSession {
  constructor({ reader, store, models, identifier, createAbortController }) {
    Object.assign(this, { reader, store, models, identifier, createAbortController });
    this.running = new Map();
    this.listeners = new Set();
    this.pending = new Set();
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(documentId, state) {
    for (const listener of this.listeners) listener(documentId, state);
  }

  send(options) {
    const operation = ['summary-all', 'summary-page', 'summary-chapter'].includes(options.purpose)
      ? this.summarize(options)
      : this.perform(options);
    this.pending.add(operation);
    const finished = () => this.pending.delete(operation);
    operation.then(finished, finished);
    return operation;
  }

  async perform({
    activeReader,
    question,
    purpose,
    provider,
    mode = 'auto',
    translationId,
    discussionEvidence,
    capturedEvidence,
    references = [],
    includePage = true,
    ignoreSelection = false,
    displayQuestion,
  }) {
    let captured;
    try {
      if (
        capturedEvidence &&
        this.reader.current(activeReader).document.id !== capturedEvidence.document.id
      )
        throw new ReadingError('reader-changed');
      captured = capturedEvidence || this.reader.capture(activeReader);
      if (ignoreSelection && !capturedEvidence)
        captured = {
          ...captured,
          selection: null,
          pageIndex: this.reader.current(activeReader).pageIndex,
        };
    } catch (error) {
      if (error instanceof ReadingError) throw error;
      throw new ReadingError('reader-capture');
    }
    const documentId = captured.document.id;
    if (this.running.has(documentId)) return;
    const controller = this.createAbortController();
    const providerSnapshot = provider ? clone(provider) : null;
    this.running.set(documentId, controller);
    let expired = false;
    const timeout = this.store.configuration?.().timeout || 120000;
    const timer = setTimeout(() => {
      expired = true;
      controller.abort();
    }, timeout);
    this.emit(documentId, { state: 'preparing', capture: captured });
    let session;
    let turn;
    try {
      if (!provider) throw new ReadingError('unconfigured');
      session = await this.store.session(documentId);
      const previous = session.turns.findLast((entry) => {
        return ['complete', 'needs-review'].includes(entry.state);
      });
      const previousEvidence =
        discussionEvidence?.document.id === documentId ? discussionEvidence : previous?.snapshot;
      const decision = decideEvidence(question, captured, previousEvidence, mode);
      if (decision.choice === 'clarify') {
        this.emit(documentId, {
          state: 'choose-evidence',
          current: captured,
          previous: previousEvidence,
          question,
          purpose,
          provider: providerSnapshot,
        });
        return;
      }
      const capture = {
        ...decision.evidence,
        references: clone(references),
        includePage,
        ...(!includePage ? { images: [], selection: null } : {}),
      };
      this.emit(documentId, { state: 'evidence-fixed', capture });
      if (
        includePage &&
        ['ask', 'vision'].includes(purpose) &&
        !capture.summaryScope &&
        modelCapabilities(providerSnapshot).vision &&
        !capture.selection?.text &&
        !capture.images.length
      ) {
        throw new ReadingError('reader-image');
      }
      if (purpose === 'translate-selection' && !capture.selection?.text) {
        throw new ReadingError('selection');
      }
      const pages = await awaitWithSignal(
        this.reader.pages(activeReader, controller.signal),
        controller.signal,
      );
      controller.signal.throwIfAborted();
      const budget = Math.min(48000, Math.floor(provider.context / 2));
      const sources = [
        ...referenceSources(references),
        ...(includePage
          ? retrieveSources(pages, capture, question, purpose === 'summary-all', budget)
          : []),
      ];
      const translationTargets =
        purpose === 'translate-page'
          ? pageContent(pages, capture.pageIndex).filter((paragraph) =>
              sources.some((source) =>
                source.paragraphs.some((entry) => entry.id === paragraph.id),
              ),
            )
          : this.translationTargets(capture, sources, purpose, translationId);
      if (purpose.startsWith('translate-') && !translationTargets.length) {
        throw new ReadingError('no-text-translation');
      }
      if (includePage && !sources.length && !capture.images.length)
        throw new ReadingError('no-text');
      if (includePage && !sources.length && !modelCapabilities(provider).vision)
        throw new ReadingError('vision');
      const captureWithLabel = {
        ...capture,
        printedPage: pages[capture.pageIndex]?.printedPage || null,
        decision: {
          choice: decision.choice,
          reason: decision.reason,
          viewChanged: decision.viewChanged,
          previousPage: decision.previousPage,
          currentPage: decision.currentPage,
          requestedMode: mode,
        },
        termHistory: session.turns
          .filter((entry) => ['complete', 'needs-review'].includes(entry.state))
          .flatMap((entry) => entry.answer?.translation?.rows || [])
          .filter((row) => !row.issues?.length)
          .flatMap((row) => row.terms || []),
      };
      const snapshot = finalizeEvidence(
        captureWithLabel,
        sources,
        session.glossary,
        this.identifier(),
        {
          totalPages: pages.length,
          translationTargets,
        },
      );
      const history = session.turns
        .filter((entry) => entry.answer)
        .map((entry) => ({
          question: entry.question,
          answer: entry.answer.text.slice(0, 3000),
          evidencePages: entry.snapshot.coverage.filePages,
        }));
      const request = composeRequest({
        question,
        snapshot,
        provider: providerSnapshot,
        history,
        purpose,
      });
      turn = {
        id: this.identifier(),
        question,
        displayQuestion,
        purpose,
        provider: {
          id: provider.id,
          name: provider.name,
          model: provider.model,
          type: provider.type,
        },
        snapshot,
        scope: request.scope,
        sentEvidence: JSON.parse(request.messages[1].content).evidence,
        state: 'streaming',
        preview: '',
      };
      session.turns.push(turn);
      await this.store.saveSession(session);
      this.emit(documentId, { state: turn.state, turn });
      const raw = await this.models.run(providerSnapshot, request, {
        signal: controller.signal,
        onText: (text) => {
          if (controller.signal.aborted) return;
          turn.preview = streamingAnswerPreview(text);
          this.emit(documentId, { state: 'streaming', turn });
        },
      });
      controller.signal.throwIfAborted();
      turn.provider.model = request.actualModel || providerSnapshot.model;
      if (turn.provider.model === providerSnapshot.model)
        turn.provider.displayName = providerSnapshot.displayName;
      turn.provider.displayName =
        this.models.displayName?.(turn.provider) || turn.provider.displayName;
      turn.answer = parseAnswer(raw, snapshot, purpose.startsWith('translate-'));
      turn.state = turn.answer.state;
      delete turn.preview;
    } catch (error) {
      const feedback = errorFeedback(expired ? new ReadingError('timeout') : error, provider?.type);
      if (turn) {
        turn.state = feedback.code === 'cancelled' ? 'cancelled' : 'failed';
        turn.error = feedback;
        delete turn.preview;
      }
      this.emit(documentId, { state: 'error', error: feedback, turn });
    } finally {
      clearTimeout(timer);
      this.running.delete(documentId);
      if (session) await this.store.saveSession(session);
      this.emit(documentId, { state: turn?.state || 'idle', turn });
    }
    return turn;
  }

  translationTargets(capture, sources, purpose, translationId) {
    if (purpose === 'translate-selection') {
      return [
        {
          id: 'selection',
          text: capture.selection.text,
          pageIndex: capture.selection.pageIndexes[0],
          position: capture.selection.positions[0],
        },
      ];
    }
    const paragraphs = sources.flatMap((source) => source.paragraphs);
    if (translationId) return paragraphs.filter((paragraph) => paragraph.id === translationId);
    return paragraphs.filter((paragraph) => paragraph.pageIndex === capture.pageIndex);
  }

  cancel(documentId) {
    this.running.get(documentId)?.abort();
  }

  async close() {
    for (const controller of this.running.values()) controller.abort();
    this.listeners.clear();
    await Promise.allSettled(this.pending);
  }
}
