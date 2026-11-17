import { renderRichText } from '../ui/rich-text.js';

function escapeHTML(value) {
  const characters = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(value).replace(/[&<>"']/gu, (character) => characters[character]);
}

export function pdfURI(zotero, snapshot, pageIndex) {
  const library = zotero.Libraries.get(snapshot.document.libraryID);
  const group =
    library.libraryType === 'group'
      ? `groups/${zotero.Groups.getGroupIDFromLibraryID(library.libraryID)}`
      : 'library';
  return `zotero://open-pdf/${group}/items/${snapshot.document.key}?page=${pageIndex + 1}`;
}

export function noteHTML(zotero, turn) {
  const document = zotero.getMainWindow().document;
  const richHTML = (text) => renderRichText(document, text, { typeset: false }).outerHTML;
  const paragraphs = [
    `<h2>${escapeHTML(turn.question)}</h2>`,
    `<p>覆盖范围 ${escapeHTML(turn.answer.coverage || turn.scope)}</p>`,
    ...(turn.summary ? [] : [richHTML(turn.answer.text)]),
  ];
  const labels = {
    visual: '图中可见',
    text: '原文明确写出',
    inference: '据此推导',
    background: '背景知识（非原文）',
  };
  for (const claim of turn.answer.claims) {
    paragraphs.push(
      (turn.summary ? '' : `<p><strong>${labels[claim.kind]}</strong></p>`) + richHTML(claim.text),
    );
    for (const citation of claim.citations) {
      const url = pdfURI(zotero, turn.snapshot, citation.pageIndex);
      paragraphs.push(
        `<p><a href="${escapeHTML(url)}">PDF 第 ${citation.pageIndex + 1} 页</a> ` +
          `${escapeHTML(citation.quote)}</p>`,
      );
    }
  }
  for (const row of turn.answer.translation?.rows || []) {
    paragraphs.push(richHTML(row.original), richHTML(row.translation));
    for (const issue of row.issues) paragraphs.push(`<p>待核对 ${escapeHTML(issue)}</p>`);
  }
  for (const source of turn.summary ? [] : turn.snapshot.sources) {
    const url = pdfURI(zotero, turn.snapshot, source.pageIndex);
    paragraphs.push(
      `<p><a href="${escapeHTML(url)}">依据 PDF 第 ${source.pageIndex + 1} 页</a></p>`,
    );
  }
  paragraphs.push(`<p>依据时间 ${escapeHTML(turn.snapshot.capturedAt)}</p>`);
  return `<div>${paragraphs.join('')}</div>`;
}

export async function saveChildNote(zotero, turn) {
  const attachment = zotero.Items.get(turn.snapshot.document.itemID);
  const parent = attachment.parentItemID ? zotero.Items.get(attachment.parentItemID) : attachment;
  if (!parent.isRegularItem()) throw new Error('请先为此独立附件创建父条目，再保存子笔记。');
  if (!parent.isEditable()) throw new Error('当前文库只读。请选择可编辑的文库。');
  const note = new zotero.Item('note');
  note.libraryID = parent.libraryID;
  note.parentID = parent.id;
  note.setNote(noteHTML(zotero, turn));
  await note.saveTx();
  return note.id;
}
