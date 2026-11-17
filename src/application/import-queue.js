import { canonicalURL, documentIdentity } from '../domain/identity.js';
import { moveImport, recoverImport } from '../domain/import-state.js';

export class ImportQueue {
  constructor(repository, storage) {
    this.repository = repository;
    this.storage = storage;
    this.jobs = new Map();
    this.queue = Promise.resolve();
    this.closed = false;
  }

  async initialize() {
    const jobs = await this.storage.read('imports-v2', []);
    for (const job of jobs) this.jobs.set(job.id, recoverImport(job));
  }

  persist() {
    return this.storage.write('imports-v2', [...this.jobs.values()]);
  }

  async submit(input, destination) {
    if (this.closed) throw new Error('插件正在停用，请稍后重试。');
    if (!/^[\w-]{8,100}$/u.test(input.id || '')) throw new Error('保存请求无效，请重新点击保存。');
    const url = new URL(input.url);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
      throw new Error('请从 HTTP 或 HTTPS 文献详情页保存。');
    }
    if (typeof input.html !== 'string' || input.html.length > 8e6) {
      throw new Error('页面过大或没有可识别内容，请打开单篇文献详情页。');
    }
    let job = this.jobs.get(input.id);
    const sourceURL = canonicalURL(input.url);
    if (job && job.url !== sourceURL) throw new Error('保存请求与页面不一致，请刷新后重试。');
    if (job && !['partial', 'failed'].includes(job.state)) return this.status(job.id);
    job ||= { id: input.id, url: sourceURL, state: 'queued', ...destination };
    job = moveImport(job, job.itemID ? 'pdf' : 'detecting');
    this.jobs.set(job.id, job);
    await this.persist();
    this.queue = this.queue
      .catch(() => {})
      .then(async () => {
        try {
          await this.process(job, input);
        } catch {
          job.state = job.itemID ? 'partial' : 'failed';
          await this.persist();
        }
      });
    return this.status(job.id);
  }

  async process(job, input) {
    await this.repository.validateDestination(job);
    if (!job.itemID) {
      const metadata = await this.repository.translate(input);
      metadata.url ||= job.url;
      if (/arxiv\.org\/(abs|pdf)\//u.test(job.url)) metadata.url = job.url;
      job.identity = documentIdentity(metadata);
      job.title = metadata.title;
      job.pdfURLs = [
        ...new Set(
          (metadata.attachments || [])
            .filter((attachment) => {
              return (
                attachment.mimeType === 'application/pdf' ||
                /\.pdf(?:$|\?)/iu.test(attachment.url || '')
              );
            })
            .map((attachment) => attachment.url)
            .filter((url) => /^https?:\/\//u.test(url || '')),
        ),
      ];
      const previous = [...this.jobs.values()].find((entry) => {
        return (
          entry !== job &&
          entry.itemID &&
          entry.libraryID === job.libraryID &&
          entry.identity &&
          entry.identity === job.identity
        );
      });
      const existing = await this.repository.findExisting(metadata, job, previous?.itemID);
      job.itemID = existing || (await this.repository.createParent(metadata, job));
      job.duplicate = Boolean(existing);
      job.state = moveImport(job, 'metadata').state;
      await this.persist();
    }
    if (await this.repository.hasPDF(job.itemID)) {
      job.hasPDF = true;
      job.state = 'complete';
      await this.persist();
      return;
    }
    if (!job.pdfURLs?.length) {
      job.state = 'complete';
      job.hasPDF = false;
      await this.persist();
      return;
    }
    if (job.state === 'metadata') job.state = moveImport(job, 'pdf').state;
    await this.persist();
    job.hasPDF = await this.repository.downloadPDF(job);
    job.state = moveImport(job, job.hasPDF ? 'complete' : 'partial').state;
    await this.persist();
  }

  status(identifier) {
    const job = this.jobs.get(identifier);
    if (!job) throw new Error('找不到保存任务，请重新点击保存。');
    let message = '正在识别和保存…';
    if (job.state === 'failed') message = '保存失败，请检查网络和目标文库后重试。';
    if (job.state === 'partial') message = '已保存条目，未取得 PDF';
    if (job.state === 'complete') {
      message = job.duplicate
        ? '文库中已有此文献'
        : job.hasPDF
          ? '已保存条目和 PDF'
          : '已保存条目，未取得 PDF';
    }
    return {
      id: job.id,
      state: job.state,
      itemID: job.itemID,
      hasPDF: Boolean(job.hasPDF),
      pdfURLs: job.pdfURLs || [],
      message,
    };
  }

  async supplement(input) {
    if (this.closed) throw new Error('插件正在停用，请稍后重试。');
    this.queue = this.queue
      .catch(() => {})
      .then(async () => {
        const job = this.jobs.get(input.id);
        if (!job?.itemID || !['complete', 'partial'].includes(job.state)) {
          throw new Error('请等待条目保存完成。');
        }
        if (!job.pdfURLs.includes(input.url)) throw new Error('PDF 地址与检测结果不一致。');
        if (!(await this.repository.hasPDF(job.itemID))) {
          await this.repository.attachBytes(job, input.base64);
        }
        job.state = 'complete';
        job.hasPDF = true;
        await this.persist();
        return this.status(job.id);
      });
    return this.queue;
  }

  async close() {
    this.closed = true;
    await this.queue.catch(() => {});
  }
}
