import { immutable } from './immutable.js';

/** PDF file indexes are zero-based. printedPage is a PDF pageLabel, never an inferred offset. */
export function describePage(pageIndex, printedPage = null) {
  const filePage = `PDF 第 ${pageIndex + 1} 页`;
  return printedPage ? `${filePage} · 印刷页码 ${printedPage}` : filePage;
}

export function captureEvidence(view, identifier, capturedAt = new Date().toISOString()) {
  if (!view.document?.id || !Number.isInteger(view.pageIndex) || view.pageIndex < 0) {
    throw new Error('无法确定当前文档和页序。请等待 PDF 加载完成。');
  }
  return immutable({
    schemaVersion: 1,
    id: identifier,
    capturedAt,
    document: view.document,
    pageIndex: view.pageIndex,
    printedPage: view.printedPage || null,
    selection: view.selection || null,
    images: view.images || [],
    visiblePages: view.visiblePages || [view.pageIndex],
    warnings: view.warnings || [],
  });
}

export function selectEvidence(question, current, previous, mode = 'auto') {
  return decideEvidence(question, current, previous, mode).evidence;
}

export function sameView(first, second) {
  if (first.document.id !== second.document.id || first.pageIndex !== second.pageIndex)
    return false;
  if ((first.selection?.text || '') !== (second.selection?.text || '')) return false;
  if (JSON.stringify(first.selection?.positions) !== JSON.stringify(second.selection?.positions)) {
    return false;
  }
  if (JSON.stringify(first.visiblePages) !== JSON.stringify(second.visiblePages)) return false;
  const regions = (snapshot) =>
    snapshot.images.map((image) => ({
      pageIndex: image.pageIndex,
      region: image.region && Object.values(image.region).map((value) => Math.round(value * 50)),
    }));
  return JSON.stringify(regions(first)) === JSON.stringify(regions(second));
}

export function decideEvidence(question, current, previous, mode = 'auto') {
  const comparable = previous?.document.id === current.document.id;
  const changed = comparable && !sameView(current, previous);
  const choose = (choice, reason) => ({
    evidence: choice === 'previous' ? previous : current,
    choice,
    reason,
    viewChanged: Boolean(changed),
    previousPage: comparable ? previous.pageIndex : null,
    currentPage: current.pageIndex,
  });
  if (!comparable) return choose('current', 'new-document');
  if (mode === 'current' || mode === 'previous') return choose(mode, 'explicit-control');
  if (!changed) return choose('previous', 'same-view');
  const text = question.trim();
  const newView = /现在这(?:张|页|幅)|这张新的|翻到的这页|刚翻到|改用当前|当前视图/u;
  if (newView.test(text)) return choose('current', 'explicit-new-view');
  const discussion = /^(为什么[？?。!！]*$|为啥|再解释|简单一点|逐句讲|推一遍|举个反例)/u;
  const anchored = /上一(?:轮|张|页)|刚才(?:的|那)|这一页为什么这样写|当前的结论|这里为什么这样翻/u;
  const elaboration = /(?:请)?(?:举|给).*(?:反例|例子)|详细解释(?:一下)?[。？?]*$/u;
  if (discussion.test(text) || anchored.test(text) || elaboration.test(text)) {
    return choose('previous', 'discussion-follow-up');
  }
  return { ...choose('current', 'ambiguous-changed-view'), choice: 'clarify', evidence: null };
}

export function finalizeEvidence(capture, sources, glossary, requestId, options = {}) {
  const imageOnlyPages = capture.images
    .filter((image) => {
      return !sources.some((source) => source.pageIndex === image.pageIndex);
    })
    .map((image) => ({
      id: `page-${image.pageIndex + 1}`,
      pageIndex: image.pageIndex,
      printedPage: image.pageIndex === capture.pageIndex ? capture.printedPage : null,
      paragraphs: [],
      text: '',
      imageOnly: true,
      truncated: false,
    }));
  sources = [...sources, ...imageOnlyPages];
  const paragraphs = sources.flatMap((source) => source.paragraphs || []);
  return immutable({
    ...capture,
    id: requestId,
    basedOn: capture.id,
    sources,
    glossary,
    translationTargets:
      options.translationTargets ||
      paragraphs.filter((paragraph) => {
        return paragraph.pageIndex === capture.pageIndex;
      }),
    coverage: {
      filePages: [...new Set(sources.map((source) => source.pageIndex + 1))],
      totalPages: options.totalPages || null,
      truncated: sources.some((source) => source.truncated),
    },
  });
}

export function evidenceLabel(snapshot) {
  return describePage(snapshot.pageIndex, snapshot.printedPage);
}

export function evidenceScope(snapshot, includeImages) {
  const imageCount = includeImages ? snapshot.images.length : 0;
  const pages = [...snapshot.coverage.filePages].sort((first, second) => first - second).join('、');
  return `${imageCount ? `${imageCount} 张可见区域图像` : '仅文本'} + PDF ${pages} 页原文`;
}

export function resolveCitation(snapshot, citation) {
  if (!citation || typeof citation.sourceId !== 'string') return null;
  const source = snapshot.sources.find((entry) => entry.id === citation.sourceId);
  if (!source) return null;
  const paragraph = source.paragraphs.find((entry) => {
    return entry.id === citation.paragraphId;
  });
  const quote = typeof citation.quote === 'string' ? citation.quote : '';
  const verifiedQuote = Boolean(quote && source.text.includes(quote));
  return {
    sourceId: source.id,
    pageIndex: source.pageIndex,
    printedPage: source.printedPage,
    quote: verifiedQuote ? quote : paragraph?.text || source.text.slice(0, 140),
    verifiedQuote,
    position: verifiedQuote ? paragraph?.position || null : null,
  };
}
