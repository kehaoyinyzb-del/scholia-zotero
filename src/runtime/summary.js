import {
  summarySources,
  summaryChunks,
  pageRanges,
  chapterSections,
  summaryInstruction,
} from '../domain/summary.js';
import { finalizeEvidence, captureEvidence } from '../domain/evidence.js';
import { composeRequest } from '../domain/prompt.js';

import { parseAnswer, streamingAnswerPreview } from '../domain/answer.js';
import { ReadingError, errorFeedback } from '../domain/errors.js';
import { saveChildNote } from './notes.js';
import { errorControls } from '../ui/error-controls.js';
import { element, action } from '../ui/dom.js';
import { awaitWithSignal } from '../application/cancellation.js';

function summaryRequest(options) {
  const snapshot = {
    ...options.snapshot,
    images: [],
    translationTargets: [],
    sources: options.snapshot.sources.map((source) => ({
      id: source.id,
      pageIndex: source.pageIndex,
      printedPage: source.printedPage,
      text: source.text,
      paragraphs: source.paragraphs.map(({ id, text, pageIndex }) => ({ id, text, pageIndex })),
    })),
  };
  return composeRequest({ ...options, snapshot });
}

export class SummaryService {
  constructor(application) {
    this.application = application;
  }

  async fromLibrary(item, window) {
    const app = this.application;
    const { Zotero } = app.environment;
    const attachment = item.isPDFAttachment() ? item : await item.getBestAttachment();
    if (!attachment?.isPDFAttachment()) throw new Error('请选择带 PDF 附件的条目。');
    const id = `${attachment.libraryID}-${attachment.key}`;
    const root = element(window.document, 'section', null, {
      class: 'rc-settings rc-library-summary',
      role: 'dialog',
      'aria-label': '总结全文',
    });
    const status = element(window.document, 'p', '正在读取文献…');
    const cancel = action(window.document, '停止', () => app.sessions.cancel(id));
    root.append(element(window.document, 'h3', '总结全文'), status, cancel);
    window.document.documentElement.append(root);
    app.windowResources.get(window)?.push(root);
    const unsubscribe = app.sessions.subscribe((documentId, state) => {
      if (id !== documentId) return;
      if (state.message) status.textContent = state.message;
      if (state.error) {
        status.textContent = state.error.title + '。' + state.error.action;
        root.querySelector('.rc-error-actions')?.remove();
        root.append(errorControls(window.document, app, state.error));
      }
    });
    try {
      const config = app.store.configuration();
      const turn = await app.sessions.send({
        attachment,
        purpose: 'summary-all',
        provider: config.providers.find((provider) => provider.id === config.routes.ask),
      });
      if (turn?.answer) {
        const noteID = await saveChildNote(Zotero, turn);
        status.textContent = '全文总结已存为子笔记。';
        root.append(
          action(window.document, '打开笔记', () => window.ZoteroPane.selectItem(noteID)),
        );
      }
    } catch (error) {
      status.textContent = errorFeedback(error).title + '。请稍后重试。';
      root.append(errorControls(window.document, app, errorFeedback(error)));
    } finally {
      unsubscribe();
      cancel.remove();
      root.append(action(window.document, '关闭', () => root.remove()));
    }
  }

  async libraryPages(attachment, signal) {
    const worker = this.application.environment.Zotero.PDFWorker;
    const result = await awaitWithSignal(worker.getFullText(attachment.id, null), signal);
    let texts = result.text.split('\f');
    // The native worker trims leading/trailing empty pages. Preserve file page numbering.
    if (texts.length !== result.totalPages) {
      texts = [];
      for (let index = 0; index < result.totalPages; index++) {
        signal.throwIfAborted();
        const page = await awaitWithSignal(worker.getFullText(attachment.id, [index]), signal);
        texts.push(page.text);
      }
    }
    return texts.map((text, pageIndex) => ({
      pageIndex,
      text,
      printedPage: null,
      paragraphs: text
        .split('\n')
        .filter((value) => value.trim())
        .map((value, index) => ({
          id: `p${pageIndex + 1}-${index}`,
          pageIndex,
          text: value,
          position: null,
        })),
    }));
  }

  async run({ activeReader, attachment, provider, purpose, regenerate = false }) {
    const app = this.application;
    const { Zotero } = app.environment;
    const captured = activeReader
      ? app.reader.capture(activeReader)
      : captureEvidence(
          {
            document: {
              id: `${attachment.libraryID}-${attachment.key}`,
              itemID: attachment.id,
              key: attachment.key,
              libraryID: attachment.libraryID,
            },
            pageIndex: 0,
          },
          app.identifier(),
        );
    const id = captured.document.id;
    if (app.sessions.running.has(id)) return;
    const controller = new (Zotero.getMainWindow().AbortController)();
    const signal = controller.signal;
    app.sessions.running.set(id, controller);
    const emit = (state) => app.sessions.emit(id, state);
    let session, turn;
    try {
      session = await app.store.session(id);
      attachment ||= Zotero.Items.get(captured.document.itemID);
      const fileHash = await attachment.attachmentHash;
      if (purpose === 'summary-all' && session.summary?.fileHash === fileHash && !regenerate) {
        emit({ state: 'complete', turn: session.summary });
        return session.summary;
      }
      if (!provider) throw new ReadingError('unconfigured');
      emit({ state: 'preparing', message: '正在读取文献…' });
      const pages = activeReader
        ? await app.reader.pages(activeReader, signal)
        : await this.libraryPages(attachment, signal);
      signal.throwIfAborted();
      let selected = pages;
      let chapters = [];
      if (purpose === 'summary-chapter') {
        const chapter = await app.notebooks.chapter(activeReader, captured.pageIndex, pages.length);
        if (!chapter) throw new ReadingError('summary-chapter');
        selected = pages.filter((page) => chapter.pages.includes(page.pageIndex));
        chapters = [{ title: chapter.title, pages: pageRanges(chapter.pages) }];
      }
      if (purpose === 'summary-all') {
        const outline = activeReader ? await app.notebooks.outline(activeReader) : [];
        const sections = chapterSections(pages, outline);
        // Page groups are not chapters; without titles the model follows the text structure.
        chapters = (sections.every((section) => section.named) ? sections : []).map((section) => ({
          title: section.title,
          pages: pageRanges(section.pages),
        }));
      }
      if (purpose === 'summary-page')
        selected = pages.filter((page) => page.pageIndex === captured.pageIndex);
      const sources = summarySources(selected);
      if (!sources.length) throw new ReadingError('summary-no-text');
      const missing = selected.filter((page) => !page.text.trim()).map((page) => page.pageIndex);
      const coverage =
        `已读第 ${pageRanges(sources.map((source) => source.pageIndex))} 页文字（图像未读）` +
        (missing.length ? `；第 ${pageRanges(missing)} 页没有文本层，未纳入` : '');
      const snapshot = finalizeEvidence(
        { ...captured, selection: null, summaryScope: purpose },
        sources,
        session.glossary,
        app.identifier(),
        { totalPages: pages.length },
      );
      const chunks = summaryChunks(
        sources,
        Math.min(32000, Math.max(256, Math.floor((provider.context - 2500) * 0.6))),
      );
      const notes = [];
      if (chunks.length > 1) {
        for (const chunk of chunks) {
          signal.throwIfAborted();
          emit({
            state: 'preparing',
            message: `正在读第 ${pageRanges(chunk.map((page) => page.pageIndex))} 页`,
          });
          const part = {
            ...snapshot,
            sources: chunk,
            translationTargets: [],
            coverage: { ...snapshot.coverage, filePages: chunk.map((page) => page.pageIndex + 1) },
          };
          const request = summaryRequest({
            snapshot: part,
            provider,
            purpose: 'summary-part',
            question:
              '逐页记录本部分的核心内容，每页至少一条 claim，并引用该页原文。保留问题、方法、贡献、定量结果和限制。参考文献页只标明内容类型，不推测被引论文。',
          });
          request.messages[0].content +=
            '\n本次是逐页阅读笔记，不受三段或八处出处限制。每页至少一条带原文出处的 claim，每页约150字，保留组间数据、终点和限定。';
          const raw = await app.models.run(provider, request, { signal, onText: () => {} });
          const answer = parseAnswer(raw, part);
          const cited = answer.claims.filter((claim) => claim.citations.length);
          if (!cited.length) throw new ReadingError('summary-citation');
          notes.push(...cited);
        }
      }
      const evidenceSources = notes.length
        ? sources
            .map((source) => ({
              ...source,
              paragraphs: source.paragraphs.filter((paragraph) =>
                notes.some((note) =>
                  note.citations.some(
                    (citation) =>
                      citation.pageIndex === source.pageIndex &&
                      paragraph.text.includes(citation.quote),
                  ),
                ),
              ),
            }))
            .filter((source) => source.paragraphs.length)
        : sources;
      const request = summaryRequest({
        snapshot: { ...snapshot, sources: evidenceSources, translationTargets: [] },
        provider,
        purpose,
        question: summaryInstruction,
      });
      request.messages[0].content +=
        '\n' +
        summaryInstruction +
        '\nreadingNotes 是前面已完整读取各分块后形成的笔记，可据此综合全文。' +
        'chapters 是程序从文献目录或正文标题识别出的章节（标题与页码范围），总结时按此逐章组织。' +
        '最终 sources 是为核对出处选出的原文段落，不代表只读了这些页。' +
        '覆盖范围以程序提供的 coverage 为准，不把未在最终摘录中重复出现的页说成未读。';
      if (notes.length || chapters.length)
        request.messages[1].content = JSON.stringify({
          ...JSON.parse(request.messages[1].content),
          ...(notes.length ? { readingNotes: notes } : {}),
          ...(chapters.length ? { chapters } : {}),
          coverage,
        });
      turn = {
        id: app.identifier(),
        question: {
          'summary-all': '总结全文',
          'summary-page': '总结本页',
          'summary-chapter': '总结本章',
        }[purpose],
        purpose,
        provider: {
          id: provider.id,
          name: provider.name,
          type: provider.type,
          model: provider.model,
          displayName: provider.displayName,
        },
        snapshot,
        scope: coverage,
        state: 'streaming',
        preview: '',
        summary: true,
        fileHash,
        readingNotes: notes,
      };
      session.turns.push(turn);
      await app.store.saveSession(session);
      emit({ state: 'streaming', turn });
      const raw = await app.models.run(provider, request, {
        signal,
        onText: (text) => {
          turn.preview = streamingAnswerPreview(text);
          emit({ state: 'streaming', turn });
        },
      });
      signal.throwIfAborted();
      turn.answer = parseAnswer(raw, snapshot);
      if (!turn.answer.claims.some((claim) => claim.citations.length))
        throw new ReadingError('summary-citation');
      turn.answer.coverage = coverage;
      turn.provider.model = request.actualModel || provider.model;
      turn.provider.displayName = app.models.displayName(turn.provider);
      turn.state = 'complete';
      delete turn.preview;
      if (purpose === 'summary-all') session.summary = turn;
      await app.store.saveSession(session);
      emit({ state: 'complete', turn });
      return turn;
    } catch (error) {
      const feedback = errorFeedback(error, provider?.type);
      if (turn) {
        turn.state = 'failed';
        turn.error = feedback;
        delete turn.answer;
      }
      emit({ state: 'error', error: feedback, turn });
      if (session) await app.store.saveSession(session);
    } finally {
      app.sessions.running.delete(id);
    }
  }
}
