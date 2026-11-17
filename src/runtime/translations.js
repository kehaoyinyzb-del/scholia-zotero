import { OfflineDictionary } from '../domain/dictionary.js';
import { selectionContextDetails, documentOccurrences } from '../domain/document-context.js';
import {
  cacheIdentity,
  cacheKey,
  matchingEntry,
  glossaryStamp,
} from '../domain/translation-cache.js';

export class TranslationService {
  constructor(application) {
    this.application = application;
    this.documents = new Map();
    this.loads = new Map();
    this.tasks = new Set();
  }

  initialize() {
    const contents = this.application.environment.Zotero.File.getContentsFromURL(
      this.application.rootURI + 'dictionaries/ecdict.json',
    );
    this.dictionary = new OfflineDictionary(JSON.parse(contents).entries);
  }

  async load(documentId) {
    if (this.documents.has(documentId)) return this.documents.get(documentId);
    if (this.loads.has(documentId)) return this.loads.get(documentId);
    const loading = this.application.store
      .read(`translations-${documentId}`, {
        version: 1,
        entries: {},
      })
      .then((value) => {
        const document = value.version === 1 && value.entries ? value : { version: 1, entries: {} };
        this.documents.set(documentId, document);
        return document;
      });
    this.loads.set(documentId, loading);
    try {
      return await loading;
    } finally {
      this.loads.delete(documentId);
    }
  }

  metadata(itemID) {
    const item = this.application.environment.Zotero.Items.get(itemID);
    const parent = item?.parentItem || item;
    const field = (name) => {
      try {
        return String(parent?.getField(name) || '');
      } catch {
        return '';
      }
    };
    return {
      title: field('title').slice(0, 300),
      publication: field('publicationTitle').slice(0, 160),
      abstract: field('abstractNote')
        .split(/(?<=[.!?。])\s/u)[0]
        .slice(0, 400),
    };
  }

  options(documentId, provider, session) {
    return {
      documentId,
      provider,
      glossary: session.glossary,
      language: this.application.store.configuration().translation?.language || '中文',
    };
  }

  identity(source, context, pageIndex, options) {
    return cacheIdentity({ source, context, pageIndex, ...options });
  }

  find(documentId, identity) {
    return matchingEntry(this.documents.get(documentId)?.entries || {}, identity);
  }

  async saveEntry(documentId, identity, value) {
    const document = await this.load(documentId);
    document.entries[cacheKey(identity)] = { identity, ...value, savedAt: Date.now() };
    const entries = Object.entries(document.entries).sort((a, b) => b[1].savedAt - a[1].savedAt);
    document.entries = Object.fromEntries(entries.slice(0, 600));
    await this.application.store.write(`translations-${documentId}`, document);
  }

  invalidate(session) {
    const document = this.documents.get(session.documentId);
    if (!document) return;
    let changed = false;
    for (const entry of Object.values(document.entries)) {
      const { source, context, glossary } = entry.identity;
      if (glossary !== glossaryStamp(session.glossary, source + ' ' + context)) {
        entry.stale = true;
        changed = true;
      }
    }
    if (changed) {
      const work = this.application.store
        .write(`translations-${session.documentId}`, document)
        .catch((error) => this.application.recordFailure(error, 'cache-invalidation'))
        .finally(() => this.tasks.delete(work));
      this.tasks.add(work);
    }
  }

  async context(reader, annotation, signal) {
    const context = await this.application.reader.selectionContext(reader, annotation, signal);
    const cached = await this.application.reader.pages(reader, signal);
    return selectionContextDetails({
      pages: cached,
      selected: annotation.text,
      context,
      pageIndex: annotation.position.pageIndex,
      position: annotation.position,
      metadata: this.metadata(reader.itemID),
    });
  }

  async details(reader, selected, signal) {
    const pages = await this.application.reader.pages(reader, signal);
    return documentOccurrences(pages, selected, 5);
  }

  async close() {
    this.closed = true;
    await Promise.allSettled(this.tasks);
    this.documents.clear();
  }
}
