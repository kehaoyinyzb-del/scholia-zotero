import {
  prepareNotebook,
  notebookRequest,
  parseNotebook,
  sourceReferences,
  pageList,
} from '../domain/notebook.js';
import { ReadingError } from '../domain/errors.js';
import { renderRichText } from '../ui/rich-text.js';
import { pdfURI } from './notes.js';
import { element } from '../ui/dom.js';

export function nativeNoteRichText(document, text) {
  const root = renderRichText(document, text, { typeset: false });
  for (const formula of root.querySelectorAll('.rc-formula')) {
    const expression = formula.querySelector(
      'annotation[encoding="application/x-tex"]',
    )?.textContent;
    if (!expression) continue;
    const display = formula.querySelector('math')?.getAttribute('display') === 'block';
    const native = element(document, display ? 'pre' : 'span');
    native.className = 'math';
    native.textContent = display ? `$$${expression}$$` : `$${expression}$`;
    if (display && formula.parentElement?.textContent === formula.textContent)
      formula.parentElement.replaceWith(native);
    else formula.replaceWith(native);
  }
  for (const table of root.querySelectorAll('.rc-table-scroll'))
    table.replaceWith(table.firstChild);
  return root;
}

export function notebookHTML(zotero, draft, snapshot) {
  const document = zotero.getMainWindow().document;
  const root = element(document, 'div');
  root.setAttribute('data-schema-version', '9');
  const append = (tag, text) => {
    const node = element(document, tag);
    node.textContent = text;
    root.append(node);
    return node;
  };
  append('h1', draft.title);
  append('p', `覆盖范围：${draft.material.coverage}`);
  const sources = new Map(draft.material.sources.map((source) => [source.id, source]));
  const attachment = zotero.Items.get(snapshot.document.itemID);
  const cited = new Map();
  for (const section of draft.sections) {
    append('h2', section.title);
    for (const point of section.points) {
      if (point.added) append('p', '模型补充');
      else if (point.kind === 'inference') append('p', '据此推导');
      if (point.kind === 'user') {
        append('p', '我的话');
        const text = append('p', point.text);
        text.style.whiteSpace = 'pre-wrap';
      } else root.append(nativeNoteRichText(document, point.text));
      const references = append('p', '出处：');
      const pointNumbers = new Set();
      for (const id of point.sources) {
        const source = sources.get(id);
        for (const reference of sourceReferences(source)) {
          const key = JSON.stringify([
            reference.pageIndex,
            reference.annotationKey,
            reference.quote || source.text,
            reference.position,
          ]);
          if (!cited.has(key))
            cited.set(key, {
              number: cited.size + 1,
              source,
              reference,
            });
          const link = element(document, 'a');
          link.href =
            pdfURI(zotero, snapshot, reference.pageIndex) +
            (reference.annotationKey ? `&annotation=${reference.annotationKey}` : '');
          link.textContent = `[${cited.get(key).number}]`;
          link.title = `第 ${reference.pageIndex + 1} 页`;
          const number = cited.get(key).number;
          if (!pointNumbers.has(number) && pointNumbers.size < 3)
            references.append(link, document.createTextNode(' '));
          pointNumbers.add(number);
        }
      }
      if (pointNumbers.size > 3)
        references.append(
          document.createTextNode(
            `其余出处见文末：${[...pointNumbers]
              .slice(3)
              .map((number) => `[${number}]`)
              .join('、')}`,
          ),
        );
    }
  }
  const comments = draft.material.scope.startsWith('annotations')
    ? []
    : draft.material.sources.filter((source) => source.comment);
  if (comments.length) {
    append('h2', '标注评论（原文保留）');
    for (const source of comments) {
      append('p', `第 ${source.pageIndex + 1} 页：${source.comment}`);
    }
  }
  append('h2', '原文出处');
  for (const { number, source, reference } of cited.values()) {
    const row = append('p', `[${number}] 第 ${reference.pageIndex + 1} 页 `);
    const quote = element(document, 'span', reference.quote || source.text);
    if (reference.verifiedQuote === false) {
      row.append(document.createTextNode('讨论依据（未逐字核对）：'));
    } else if (reference.position?.rects?.length) {
      quote.className = 'highlight';
      quote.setAttribute(
        'data-annotation',
        encodeURIComponent(
          JSON.stringify({
            attachmentURI: zotero.URI.getItemURI(attachment),
            ...(reference.annotationKey ? { annotationKey: reference.annotationKey } : {}),
            color: reference.color || '#ffd400',
            pageLabel: reference.pageLabel,
            position: reference.position,
          }),
        ),
      );
    }
    row.append(quote);
  }
  return root.outerHTML;
}

export class NotebookService {
  constructor(application) {
    this.application = application;
    this.pending = new Set();
  }

  track(operation) {
    this.pending.add(operation);
    const finished = () => this.pending.delete(operation);
    operation.then(finished, finished);
    return operation;
  }

  close() {
    return Promise.allSettled(this.pending);
  }

  /** PDF bookmarks as { title, index, depth }; an unreadable outline yields []. */
  async outline(reader) {
    const { application } = this.application.reader.pdf(reader);
    const pdf = application.pdfDocument;
    const entries = [];
    const visit = async (items, depth = 0) => {
      for (const item of items || []) {
        let destination = item.dest;
        if (typeof destination === 'string') destination = await pdf.getDestination(destination);
        if (Array.isArray(destination)) {
          const index = Number.isInteger(destination[0])
            ? destination[0]
            : await pdf.getPageIndex(destination[0]);
          entries.push({ title: item.title, index, depth });
        }
        await visit(item.items, depth + 1);
      }
    };
    try {
      await visit(await pdf.getOutline());
    } catch {
      return [];
    }
    return entries;
  }

  async chapter(reader, pageIndex, count) {
    const entries = await this.outline(reader);
    const section = entries
      .filter((entry) => entry.index <= pageIndex)
      .sort((a, b) => b.index - a.index || b.depth - a.depth)[0];
    if (!section) return null;
    const end = Math.min(
      count,
      ...entries
        .filter((entry) => entry.index > pageIndex && entry.depth <= section.depth)
        .map((entry) => entry.index),
    );
    return {
      title: section.title,
      pages: Array.from({ length: end - section.index }, (_, index) => section.index + index),
    };
  }

  async prepare(reader, scope, signal) {
    const app = this.application;
    const { Zotero } = app.environment;
    const snapshot = app.reader.current(reader);
    const session = await app.store.session(snapshot.document.id);
    const attachment = Zotero.Items.get(reader.itemID);
    const parent = attachment.parentID ? Zotero.Items.get(attachment.parentID) : attachment;
    const config = app.store.configuration();
    const provider = config.providers.find((entry) => entry.id === config.routes.ask);
    if (!provider) throw new ReadingError('unconfigured');
    if (scope.startsWith('annotations')) {
      const entries = await app.readingNotes.list(reader.itemID);
      if (!entries.length) throw new Error('先在 PDF 里划线或记一条笔记，再整理。');
      const sources = entries.map((entry) => ({
        id: `a-${entry.key}`,
        kind: 'annotation',
        text: entry.text,
        comment: entry.comment,
        pageIndex: entry.position?.pageIndex ?? null,
        position: entry.position,
        annotationKey: entry.annotation ? entry.key : null,
        pageLabel: entry.pageLabel,
        color: entry.color,
      }));
      const budget = Math.min(48000, Math.floor(provider.context / 2));
      let used = JSON.stringify(sources).length;
      if (used > budget) throw new Error('划线和笔记超过当前模型容量，请选择上下文更大的模型。');
      if (scope === 'annotations-plus') {
        const pages = await app.reader.pages(reader, signal);
        for (const page of pages)
          for (const paragraph of page.paragraphs) {
            const source = {
              id: `p-${page.pageIndex}-${paragraph.id}`,
              kind: 'original',
              pageIndex: page.pageIndex,
              text: paragraph.text,
              position: paragraph.position,
            };
            const size = JSON.stringify(source).length;
            if (used + size > budget) continue;
            sources.push(source);
            used += size;
          }
      }
      const includedPages = [
        ...new Set(sources.map((source) => source.pageIndex).filter(Number.isInteger)),
      ];
      return {
        snapshot,
        session,
        provider,
        metadata: {
          title: parent.getField('title'),
          publication: parent.getField('publicationTitle'),
        },
        material: {
          scope,
          sources,
          questions: [],
          annotationCount: entries.length,
          turnCount: 0,
          includedPages,
          characters: used,
          coverage:
            `${entries.length} 条划线和笔记` +
            (includedPages.length ? `，涉及第 ${pageList(includedPages)} 页` : '') +
            (scope === 'annotations-plus' ? '；补充只依据本次实际纳入的正文' : '，保留用户原话'),
        },
      };
    }
    const pages = await app.reader.pages(reader, signal);
    const chapter =
      scope === 'chapter' ? await this.chapter(reader, snapshot.pageIndex, pages.length) : null;
    const annotations = attachment
      .getAnnotations()
      .filter((item) => ['highlight', 'underline', 'note'].includes(item.annotationType))
      .map((item) => ({
        key: item.key,
        text: item.annotationText || '',
        comment: item.annotationComment || '',
        position: JSON.parse(item.annotationPosition),
        color: item.annotationColor,
        pageLabel: item.annotationPageLabel,
      }));
    const material = prepareNotebook({
      pages,
      annotations,
      turns: session.turns,
      scope,
      currentPage: snapshot.pageIndex,
      chapter,
      budget: Math.min(48000, Math.floor(provider.context / 2)),
    });
    return {
      material,
      snapshot,
      provider,
      session,
      metadata: {
        title: parent.getField('title'),
        publication: parent.getField('publicationTitle'),
      },
    };
  }

  generate(...args) {
    return this.track(this.generateDraft(...args));
  }

  async generateDraft(prepared, signal, revision = '', previous = null) {
    const request = notebookRequest(
      prepared.material,
      prepared.metadata,
      prepared.session.glossary,
      revision,
      previous?.sections || null,
    );
    const raw = await this.application.models.run(prepared.provider, request, { signal });
    signal.throwIfAborted();
    const draft = parseNotebook(raw, prepared.material);
    draft.generatedAt = new Date().toISOString();
    draft.request = request;
    draft.raw = raw;
    prepared.session.notebookDraft = draft;
    await this.application.store.saveSession(prepared.session);
    return draft;
  }

  save(...args) {
    return this.track(this.saveDraft(...args));
  }

  async saveDraft(prepared, draft, mode) {
    const { Zotero } = this.application.environment;
    const attachment = Zotero.Items.get(prepared.snapshot.document.itemID);
    const parent = attachment.parentID && Zotero.Items.get(attachment.parentID);
    if (!parent?.isRegularItem() || !parent.isEditable())
      throw new Error('请先为附件设置可编辑的父条目，再保存笔记。');
    let note;
    if (mode === 'update') {
      note = Zotero.Items.get(prepared.session.notebookNoteID);
      if (!note?.isNote() || note.deleted || note.parentID !== parent.id)
        throw new Error('原笔记已移除或更换父条目，请新建笔记。');
    } else {
      note = new Zotero.Item('note');
      note.libraryID = parent.libraryID;
      note.parentID = parent.id;
    }
    note.setNote(notebookHTML(Zotero, draft, prepared.snapshot));
    await note.saveTx();
    prepared.session.notebookNoteID = note.id;
    await this.application.store.saveSession(prepared.session);
    return note.id;
  }
}
