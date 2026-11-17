import { originalSelection } from '../domain/selected-text.js';
import { renderRichText } from '../ui/rich-text.js';
import { element } from '../ui/dom.js';
import { pdfURI } from './notes.js';

export class ReadingNotes {
  constructor(application) {
    this.app = application;
    this.zotero = application.environment.Zotero;
  }

  color(reader) {
    return (
      reader?._internalReader?._tools?.highlight?.color ||
      this.zotero.Prefs.get('extensions.readingCompanion.lastHighlightColor', true) ||
      '#ffd400'
    );
  }

  async create(reader, annotation, comment, translation = '') {
    const include = this.app.store.configuration().translation.annotationComment;
    const text =
      comment + (include && translation ? `${comment ? '\n\n' : ''}译文\n${translation}` : '');
    const color = this.color(reader);
    const item = await this.app.annotations.create(reader.itemID, { ...annotation, color }, text);
    this.zotero.Prefs.set('extensions.readingCompanion.lastHighlightColor', color, true);
    return item;
  }

  plainNote(item) {
    const document = this.zotero.getMainWindow().document;
    const root = element(document, 'div');
    root.innerHTML = item.getNote();
    return root.textContent;
  }

  async list(itemID) {
    const attachment = this.zotero.Items.get(itemID);
    const entries = attachment
      .getAnnotations()
      .filter(
        (item) => !item.deleted && ['highlight', 'underline', 'note'].includes(item.annotationType),
      )
      .map((item) => ({
        id: item.id,
        key: item.key,
        text: item.annotationText || '',
        comment: item.annotationComment || '',
        position: JSON.parse(item.annotationPosition),
        pageLabel: item.annotationPageLabel,
        color: item.annotationColor,
        sortIndex: item.annotationSortIndex,
        annotation: true,
      }));
    const parent = attachment.parentID && this.zotero.Items.get(attachment.parentID);
    for (const id of parent?.getNotes() || []) {
      const item = await this.zotero.Items.getAsync(id);
      await item.loadDataType('relations');
      if (
        item.deleted ||
        !item
          .getRelationsByPredicate('dc:relation')
          .includes(this.zotero.URI.getItemURI(attachment))
      )
        continue;
      entries.push({
        id,
        key: item.key,
        text: '',
        comment: this.plainNote(item),
        annotation: false,
      });
    }
    return entries.sort(
      (a, b) =>
        (a.position?.pageIndex ?? Infinity) - (b.position?.pageIndex ?? Infinity) ||
        (a.sortIndex || '').localeCompare(b.sortIndex || '') ||
        a.id - b.id,
    );
  }

  async update(entry, text) {
    const item = await this.zotero.Items.getAsync(entry.id);
    if (!item || item.deleted || !item.isEditable()) throw new Error('这条笔记已删除或不可编辑。');
    const current = item.isAnnotation() ? item.annotationComment || '' : this.plainNote(item);
    if (current !== entry.comment)
      throw new Error('这条笔记已在其他位置修改，请取消后重新打开编辑。');
    if (item.isAnnotation()) item.annotationComment = text;
    else item.setNote(this.textHTML(text));
    await item.saveTx();
  }

  async remove(entry) {
    const item = await this.zotero.Items.getAsync(entry.id);
    if (!item || item.deleted) return;
    if (!item.isEditable()) throw new Error('这条笔记不可编辑。');
    if (item.isAnnotation()) await item.eraseTx();
    else await this.zotero.Items.trashTx([item.id]);
  }

  textHTML(text) {
    const p = element(this.zotero.getMainWindow().document, 'p', text);
    p.style.whiteSpace = 'pre-wrap';
    return p.outerHTML;
  }

  async unanchored(itemID, text, html = this.textHTML(text), related = true) {
    const attachment = this.zotero.Items.get(itemID);
    const parent = attachment.parentID && this.zotero.Items.get(attachment.parentID);
    if (!parent?.isRegularItem() || !parent.isEditable())
      throw new Error('请先为 PDF 设置可编辑的父条目。');
    const note = new this.zotero.Item('note');
    note.libraryID = parent.libraryID;
    note.parentID = parent.id;
    note.setNote(html);
    if (related) note.addRelation('dc:relation', this.zotero.URI.getItemURI(attachment));
    await note.saveTx();
    return note;
  }

  async saveAnswer(turn, selected = '') {
    const claims = turn.answer.claims;
    if (selected) {
      const document = this.zotero.getMainWindow().document;
      const originals = [...claims.map((claim) => claim.text), turn.answer.text];
      const restored = originals
        .map(
          (text) =>
            originalSelection(text, selected) ||
            originalSelection(
              renderRichText(document, text, { typeset: false }).textContent,
              selected,
            ),
        )
        .find((text) => text !== null);
      if (!restored) throw new Error('选中文字无法对应回答原文，请重新选择回答正文。');
      selected = restored;
    }
    const matching = selected ? claims.filter((claim) => claim.text.includes(selected)) : claims;
    const citation = matching
      .flatMap((claim) => claim.citations)
      .find((entry) => entry.verifiedQuote && entry.position);
    const text = selected || claims.map((claim) => claim.text).join('\n\n') || turn.answer.text;
    if (citation) {
      try {
        return await this.app.annotations.cite(turn.snapshot, citation, text);
      } catch (error) {
        if (error.code !== 'annotation-position') throw error;
      }
    }
    return this.unanchored(turn.snapshot.document.itemID, text);
  }

  async export(itemID) {
    const entries = await this.list(itemID);
    if (!entries.length) throw new Error('先在 PDF 里划线或记一条笔记。');
    const attachment = this.zotero.Items.get(itemID);
    const document = this.zotero.getMainWindow().document;
    const root = element(document, 'div');
    root.append(element(document, 'h1', '划线和笔记'));
    for (const entry of entries) {
      root.append(element(document, 'blockquote', entry.text));
      const comment = element(document, 'p', entry.comment);
      comment.style.whiteSpace = 'pre-wrap';
      root.append(comment);
      if (entry.position) {
        const snapshot = { document: { key: attachment.key, libraryID: attachment.libraryID } };
        root.append(
          element(document, 'a', `第 ${entry.position.pageIndex + 1} 页`, {
            href:
              pdfURI(this.zotero, snapshot, entry.position.pageIndex) + `&annotation=${entry.key}`,
          }),
        );
      }
    }
    const note = await this.unanchored(itemID, '', root.outerHTML, false);
    return note.id;
  }
}
