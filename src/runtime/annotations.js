import { sameAnnotationPosition } from '../domain/annotation.js';
import { ReadingError } from '../domain/errors.js';

export class AnnotationService {
  constructor(application) {
    this.application = application;
    this.zotero = application.environment.Zotero;
  }

  start() {
    this.observer = this.zotero.Notifier.registerObserver(
      { notify: (event, type, ids) => this.notify(event, type, ids) },
      ['item'],
      'reading-companion-annotations',
    );
  }

  arm(completed) {
    if (!completed || !this.application.store.configuration().translation.annotationComment) return;
    const attachment = this.zotero.Items.get(completed.reader.itemID);
    this.pending = {
      ...completed,
      itemID: attachment.id,
      existing: new Set(attachment.getAnnotations().map((item) => item.id)),
      expires: Date.now() + 5000,
    };
  }

  async notify(event, type, ids) {
    const pending = this.pending;
    if (event !== 'add' || type !== 'item' || !pending || Date.now() > pending.expires) return;
    try {
      for (const id of ids) {
        const item = this.zotero.Items.get(id);
        if (
          !item?.isAnnotation() ||
          item.parentID !== pending.itemID ||
          pending.existing.has(item.id) ||
          item.annotationText !== pending.annotation.text ||
          item.annotationComment ||
          !sameAnnotationPosition(JSON.parse(item.annotationPosition), pending.annotation.position)
        )
          continue;
        this.pending = null;
        item.annotationComment = pending.translation;
        item.addTag('Scholia');
        await item.saveTx();
        break;
      }
    } catch (error) {
      this.application.recordFailure(error, 'annotation-comment');
    }
  }

  async create(itemID, annotation, comment) {
    const attachment = this.zotero.Items.get(itemID);
    if (!attachment.isEditable()) throw new ReadingError('annotation-readonly');
    return this.zotero.Annotations.saveFromJSON(attachment, {
      ...annotation,
      key: this.zotero.DataObjectUtilities.generateKey(),
      type: 'highlight',
      color: annotation.color || '#ffd400',
      comment,
      tags: [{ name: 'Scholia' }],
    });
  }

  async cite(snapshot, citation, summary) {
    if (!citation.verifiedQuote || !citation.position)
      throw new ReadingError('annotation-position');
    const reader = await this.zotero.Reader.open(snapshot.document.itemID);
    const annotation = await this.application.reader.quotePosition(reader, citation);
    if (!annotation) throw new ReadingError('annotation-position');
    annotation.color = this.application.readingNotes?.color(reader) || annotation.color;
    const item = await this.create(snapshot.document.itemID, annotation, summary);
    await reader.navigate({ annotationID: item.key });
    return item;
  }

  close() {
    if (this.observer) this.zotero.Notifier.unregisterObserver(this.observer);
    this.pending = null;
  }
}
