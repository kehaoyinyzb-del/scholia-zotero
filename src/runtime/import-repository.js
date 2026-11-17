import { sameDocument } from '../domain/identity.js';

export class ImportRepository {
  constructor(environment, store) {
    this.environment = environment;
    this.store = store;
    this.zotero = environment.Zotero;
  }

  async validateDestination(job) {
    const library = this.zotero.Libraries.get(job.libraryID);
    if (!library?.editable) throw new Error('目标文库不可编辑。');
    if (job.collectionID) {
      const collection = this.zotero.Collections.get(job.collectionID);
      if (collection?.libraryID !== job.libraryID) throw new Error('分类不属于目标文库。');
    }
  }

  async translate(input) {
    const document = this.zotero.HTTP.wrapDocument(
      new this.environment.DOMParser().parseFromString(input.html, 'text/html'),
      input.url,
    );
    const translation = new this.zotero.Translate.Web();
    translation.setDocument(document);
    let timer;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('识别超时。')), 60000);
    });
    const recognize = async () => {
      const translators = await translation.getTranslators();
      if (!translators.length) throw new Error('没有适用的 translator。');
      translation.setTranslator(translators[0]);
      translation.setHandler('select', () => {
        throw new Error('请打开单篇文献详情页。');
      });
      const items = await translation.translate({ libraryID: false, saveAttachments: false });
      if (items.length !== 1) throw new Error('请打开单篇文献详情页。');
      return items[0];
    };
    try {
      return await Promise.race([recognize(), deadline]);
    } finally {
      clearTimeout(timer);
    }
  }

  async findExisting(metadata, job, previousId) {
    if (previousId) {
      const previous = await this.zotero.Items.getAsync(previousId);
      if (previous && !previous.deleted) return previous.id;
    }
    const search = new this.zotero.Search();
    search.libraryID = job.libraryID;
    search.addCondition('itemType', 'isNot', 'attachment');
    search.addCondition('itemType', 'isNot', 'note');
    if (metadata.DOI && !job.identity?.startsWith('arxiv:')) {
      search.addCondition('DOI', 'is', metadata.DOI);
    } else {
      search.addCondition('url', 'is', metadata.url);
    }
    const identifiers = await search.search();
    const items = await this.zotero.Items.getAsync(identifiers);
    return items.find((item) => !item.deleted && sameDocument(metadata, item.toJSON()))?.id || null;
  }

  async createParent(metadata, job) {
    const item = new this.zotero.Item(metadata.itemType || 'journalArticle');
    item.libraryID = job.libraryID;
    const clean = { ...metadata };
    const omitted = [
      'attachments',
      'notes',
      'seeAlso',
      'complete',
      'itemID',
      'libraryID',
      'key',
      'version',
      'relations',
      'collections',
    ];
    for (const key of omitted) delete clean[key];
    item.fromJSON(clean);
    if (job.collectionID) item.addToCollection(job.collectionID);
    await item.saveTx();
    return item.id;
  }

  async hasPDF(itemId) {
    const item = await this.zotero.Items.getAsync(itemId);
    if (!item || item.deleted) throw new Error('已保存条目不存在，请重新保存。');
    const attachments = await this.zotero.Items.getAsync(item.getAttachments());
    for (const attachment of attachments) {
      if (
        attachment.attachmentContentType === 'application/pdf' &&
        (await attachment.getFilePathAsync())
      ) {
        return true;
      }
    }
    return false;
  }

  async downloadPDF(job) {
    const library = this.zotero.Libraries.get(job.libraryID);
    if (!library.filesEditable) return false;
    for (const url of job.pdfURLs) {
      try {
        await this.zotero.Attachments.importFromURL({
          url,
          parentItemID: job.itemID,
          contentType: 'application/pdf',
          referrer: job.url,
          title: 'Full Text PDF',
        });
        if (await this.hasPDF(job.itemID)) return true;
      } catch {
        // Browser-side authorized fetch can supply the same PDF without exposing cookies.
      }
    }
    return false;
  }

  async attachBytes(job, encoded) {
    if (typeof encoded !== 'string' || encoded.length > 28e6) {
      throw new Error('浏览器补存限 20 MB。较大 PDF 请在 Zotero 中添加。');
    }
    const bytes = this.environment.atob(encoded);
    if (!bytes.slice(0, 1024).includes('%PDF-'))
      throw new Error('返回内容不是 PDF，请检查网站登录。');
    const path = this.environment.PathUtils.join(this.store.directory, `${job.id}.pdf`);
    try {
      await this.environment.IOUtils.write(
        path,
        Uint8Array.from(bytes, (character) => character.charCodeAt(0)),
        { permissions: 0o600 },
      );
      await this.zotero.Attachments.importFromFile({ file: path, parentItemID: job.itemID });
    } finally {
      await this.environment.IOUtils.remove(path, { ignoreAbsent: true });
    }
  }

  async open(itemId) {
    const item = await this.zotero.Items.getAsync(itemId);
    if (!item || item.deleted) throw new Error('条目已不存在，请重新保存。');
    const attachments = await this.zotero.Items.getAsync(item.getAttachments());
    const pdf = attachments.find(
      (attachment) => attachment.attachmentContentType === 'application/pdf',
    );
    if (pdf) await this.zotero.Reader.open(pdf.id);
    else await this.zotero.getMainWindow().ZoteroPane.selectItem(item.id);
    this.zotero.getMainWindow().focus();
  }
}
