import { surroundingSentences } from '../domain/selection.js';
import { quoteAnnotation } from '../domain/annotation.js';
import { pageExamples } from '../domain/material.js';
import { captureEvidence } from '../domain/evidence.js';
import { extractNativePage } from '../domain/native-pdf.js';
import { geometryFromBox, geometryFromCharacters } from '../domain/page-geometry.js';
import { ReadingError } from '../domain/errors.js';

export class ReaderAdapter {
  constructor(zotero, identifier, components) {
    this.zotero = zotero;
    this.identifier = identifier;
    this.components = components;
    this.cachedDocuments = new Map();
    this.selectionPages = new Map();
  }

  active(document) {
    const window = document.defaultView;
    const tabId = window.Zotero_Tabs?.selectedID;
    if (tabId) return this.zotero.Reader.getByTabID(tabId);
    return this.zotero.Reader._readers.find((reader) => reader._window === window);
  }

  pdf(reader) {
    const internal = reader?._internalReader;
    const view = internal?._lastView || internal?._primaryView;
    const application = view?._iframeWindow?.PDFViewerApplication;
    if (!application?.pdfDocument || !application?.pdfViewer) {
      throw new ReadingError('reader-not-ready');
    }
    return { view, application };
  }

  current(reader) {
    const { view, application } = this.pdf(reader);
    const item = this.zotero.Items.get(reader.itemID);
    const pageIndex = application.pdfViewer.currentPageNumber - 1;
    const cached = this.cachedDocuments.get(`${item.libraryID}-${item.key}`);
    const printedPage = cached?.pages?.[pageIndex]?.printedPage || null;
    const pageText =
      cached?.pages?.[pageIndex]?.text ||
      Array.from(
        view._pdfPages?.[pageIndex]?.chars || [],
        (char) => char.c + (char.lineBreakAfter ? '\n' : char.spaceAfter ? ' ' : ''),
      ).join('');
    return {
      document: {
        id: `${item.libraryID}-${item.key}`,
        itemID: item.id,
        key: item.key,
        libraryID: item.libraryID,
      },
      pageIndex,
      printedPage,
      selection: this.selection(view),
      examples: pageExamples(pageText),
    };
  }

  selection(view) {
    const ranges = (view._selectionRanges || []).filter((range) => !range.collapsed);
    if (!ranges.length) return null;
    return {
      text: ranges.map((range) => range.text || '').join('\n'),
      pageIndexes: ranges.map((range) => range.position.pageIndex),
      positions: ranges.map((range) => JSON.parse(JSON.stringify(range.position))),
    };
  }

  capture(reader) {
    const current = this.current(reader);
    const { application } = this.pdf(reader);
    const viewer = application.pdfViewer;
    const visible = viewer._getVisiblePages().views;
    const bounds = viewer.container.getBoundingClientRect();
    const images = [];
    const warnings = [];
    for (const entry of visible) {
      const page = entry.view || viewer.getPageView(entry.id - 1);
      const candidates = [...(page?.div?.querySelectorAll('.canvasWrapper canvas') || [])];
      if (page?.canvas) candidates.push(page.canvas);
      candidates.sort((first, second) => second.width * second.height - first.width * first.height);
      const canvas = candidates[0];
      if (!canvas?.width || !canvas.height) {
        warnings.push(`PDF 第 ${entry.id} 页图像尚未渲染。`);
        continue;
      }
      const image = this.crop(canvas, bounds, entry.id - 1);
      if (image) images.push(image);
    }
    const pageIndex = current.selection?.pageIndexes[0] ?? current.pageIndex;
    const cache = this.cachedDocuments.get(current.document.id);
    return captureEvidence(
      {
        ...current,
        pageIndex,
        printedPage: cache?.pages?.[pageIndex]?.printedPage || null,
        images,
        visiblePages: visible.map((entry) => entry.id - 1),
        warnings,
      },
      this.identifier(),
    );
  }

  crop(canvas, bounds, pageIndex) {
    const rectangle = canvas.getBoundingClientRect();
    const left = Math.max(bounds.left, rectangle.left);
    const top = Math.max(bounds.top, rectangle.top);
    const width = Math.min(bounds.right, rectangle.right) - left;
    const height = Math.min(bounds.bottom, rectangle.bottom) - top;
    if (width <= 0 || height <= 0 || !rectangle.width || !rectangle.height) return null;
    const scaleX = canvas.width / rectangle.width;
    const scaleY = canvas.height / rectangle.height;
    const cropped = canvas.ownerDocument.createElement('canvas');
    cropped.width = Math.round(width * scaleX);
    cropped.height = Math.round(height * scaleY);
    cropped
      .getContext('2d')
      .drawImage(
        canvas,
        (left - rectangle.left) * scaleX,
        (top - rectangle.top) * scaleY,
        width * scaleX,
        height * scaleY,
        0,
        0,
        cropped.width,
        cropped.height,
      );
    return {
      pageIndex,
      dataURL: cropped.toDataURL('image/png'),
      width: cropped.width,
      height: cropped.height,
      crop: { left: left - rectangle.left, top: top - rectangle.top, width, height },
      region: {
        left: (left - rectangle.left) / rectangle.width,
        top: (top - rectangle.top) / rectangle.height,
        right: (left + width - rectangle.left) / rectangle.width,
        bottom: (top + height - rectangle.top) / rectangle.height,
      },
    };
  }

  async selectionContext(reader, annotation, signal) {
    const { application, view } = this.pdf(reader);
    const current = this.current(reader);
    const pageIndex = annotation.position.pageIndex;
    const key = `${current.document.id}:${pageIndex}`;
    let cached = this.selectionPages.get(key);
    if (cached?.document !== application.pdfDocument) {
      const params = this.components.utils.cloneInto({ pageIndex }, view._iframeWindow);
      const data = await application.pdfDocument.getPageData(params);
      signal?.throwIfAborted();
      let text = '';
      const offsets = [];
      const chars = data.chars || [];
      for (let index = 0; index < chars.length; index++) {
        const char = chars[index];
        const rect = Array.from(char.inlineRect || char.rect || []);
        const next = chars[index + 1];
        const nextRect = Array.from(next?.inlineRect || next?.rect || []);
        const paragraphGap =
          char.lineBreakAfter &&
          rect.length === 4 &&
          nextRect.length === 4 &&
          rect[1] - nextRect[3] > (rect[3] - rect[1]) * 1.2;
        offsets.push({ offset: text.length, rect });
        text +=
          char.c +
          (char.paragraphBreakAfter || paragraphGap
            ? '\n\n'
            : char.spaceAfter || char.lineBreakAfter
              ? ' '
              : '');
      }
      cached = { document: application.pdfDocument, text, offsets };
      this.selectionPages.set(key, cached);
      if (this.selectionPages.size > 40)
        this.selectionPages.delete(this.selectionPages.keys().next().value);
    }
    const rect = annotation.position.rects?.[0];
    let near = 0;
    let distance = Infinity;
    for (const entry of cached.offsets) {
      if (!rect || entry.rect.length < 4) continue;
      const delta = Math.abs(entry.rect[0] - rect[0]) + Math.abs(entry.rect[1] - rect[1]) * 4;
      if (delta < distance) {
        distance = delta;
        near = entry.offset;
      }
    }
    return surroundingSentences(cached.text, annotation.text, near);
  }

  async pages(reader, signal) {
    const { application, view } = this.pdf(reader);
    const document = application.pdfDocument;
    const identifier = this.current(reader).document.id;
    const cached = this.cachedDocuments.get(identifier);
    if (cached?.document === document) return cached.pages;
    let labels;
    try {
      labels = await document.getPageLabels();
    } catch {
      labels = null;
    }
    const pages = [];
    for (let number = 1; number <= document.numPages; number++) {
      signal?.throwIfAborted();
      let pageData;
      try {
        const parameters = this.components.utils.cloneInto(
          { pageIndex: number - 1 },
          view._iframeWindow,
        );
        pageData = await document.getPageData(parameters);
        if (!pageData || !Array.isArray(pageData.chars)) throw new Error('Missing characters');
      } catch {
        throw new ReadingError('reader-text', { pageIndex: number - 1 });
      }
      const characters = Array.from(pageData.chars, (character) => ({
        c: character.c,
        ignorable: character.ignorable,
        spaceAfter: character.spaceAfter,
        lineBreakAfter: character.lineBreakAfter,
        paragraphBreakAfter: character.paragraphBreakAfter,
        inlineRect: Array.from(character.inlineRect || character.rect || []),
      }));
      const geometry = await this.geometry(application, view, number - 1, pageData, characters);
      let extracted;
      try {
        extracted = extractNativePage(
          characters,
          number - 1,
          geometry.width,
          labels?.[number - 1],
          geometry.left,
        );
      } catch {
        throw new ReadingError('reader-text', { pageIndex: number - 1 });
      }
      if (geometry.source === 'text-bounds') {
        extracted.layoutWarning += ' 页面尺寸不可用，已改用文字边界排序，请核对分栏。';
      }
      pages.push({ ...extracted, geometry });
    }
    signal?.throwIfAborted();
    this.cachedDocuments.set(identifier, { document, pages });
    return pages;
  }

  async geometry(application, view, pageIndex, pageData, characters) {
    const dataBox = geometryFromBox(pageData.viewBox, 'page-data');
    if (dataBox) return dataBox;
    const rendered = application.pdfViewer.getPageView?.(pageIndex);
    const renderedBox = geometryFromBox(rendered?.viewport?.viewBox, 'rendered-viewport');
    if (renderedBox) return renderedBox;
    // getViewport is used by Zotero 10's thumbnail renderer, including off-screen pages.
    try {
      const page = await application.pdfDocument.getPage(pageIndex + 1);
      const options = this.components.utils.cloneInto({ scale: 1 }, view._iframeWindow);
      const viewport = page.getViewport(options);
      const box = geometryFromBox(viewport?.viewBox, 'page-viewport');
      if (box) return box;
    } catch {
      // Text bounds allow local extraction when page geometry is unavailable.
    }
    const fallback = geometryFromCharacters(characters);
    if (fallback) return fallback;
    throw new ReadingError('reader-geometry', { pageIndex });
  }

  async navigate(snapshot, citation = null) {
    const reader = await this.zotero.Reader.open(snapshot.document.itemID);
    const location = citation?.position
      ? { position: citation.position }
      : { pageIndex: citation?.pageIndex ?? snapshot.pageIndex };
    await reader.navigate(location);
  }

  async quotePosition(reader, citation) {
    const { application, view } = this.pdf(reader);
    const data = await application.pdfDocument.getPageData(
      this.components.utils.cloneInto({ pageIndex: citation.pageIndex }, view._iframeWindow),
    );
    const annotation = quoteAnnotation(
      Array.from(data.chars || []),
      citation.quote,
      citation.pageIndex,
      data.viewBox?.[3] || 0,
    );
    if (annotation) annotation.pageLabel = citation.printedPage || annotation.pageLabel;
    return annotation;
  }

  clear() {
    this.cachedDocuments.clear();
    this.selectionPages.clear();
  }
}
