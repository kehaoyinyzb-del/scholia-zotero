import { captureFailure, redactDiagnostic } from '../src/domain/diagnostics.js';
import { saveWindow } from './screenshots.js';

export async function saveDiagnostics(environment, config, label, error) {
  const { Zotero, Services, IOUtils, PathUtils } = environment;
  const directory = PathUtils.join(config.runDirectory, 'diagnostics');
  await IOUtils.makeDirectory(directory, { ignoreExisting: true });
  const prefix = `${Date.now()}-${label.replace(/[^a-z0-9-]/giu, '-').slice(0, 60)}`;
  const report = {
    failure: captureFailure(error, label),
    windows: [],
    plugin: Zotero['reading-companion@local']?.diagnostics || [],
    selections: Zotero['reading-companion@local']?.selection?.records || [],
    console: Services.console
      .getMessageArray()
      .slice(-100)
      .map((entry) => redactDiagnostic(entry.message || '').slice(0, 2000)),
  };
  report.readers = Zotero.Reader._readers.map((reader) => {
    const view = reader._internalReader?._lastView || reader._internalReader?._primaryView;
    const viewer = view?._iframeWindow?.PDFViewerApplication?.pdfViewer;
    return {
      itemID: reader.itemID,
      selection: view?._selectionRanges?.map((range) => ({
        text: range.text,
        collapsed: range.collapsed,
      })),
      popup: reader._iframeWindow?.document?.querySelector('.rc-popup')?.textContent,
      pageNumber: viewer?.currentPageNumber,
      scale: viewer?.currentScale,
      visible: viewer?._getVisiblePages().views.map((entry) => entry.id),
      pages: Array.from({ length: viewer?.pagesCount || 0 }, (_, index) => {
        const page = viewer.getPageView(index);
        return {
          pageIndex: index,
          state: page?.renderingState,
          canvas: page?.canvas ? { width: page.canvas.width, height: page.canvas.height } : null,
          domCanvases: [...(page?.div?.querySelectorAll('canvas') || [])].map((canvas) => ({
            width: canvas.width,
            height: canvas.height,
            class: canvas.parentElement.className,
          })),
        };
      }),
    };
  });
  const describe = (node, depth = 0) => {
    const box = node.getBoundingClientRect();
    const style = node.ownerDocument.defaultView.getComputedStyle(node);
    return {
      tag: node.localName,
      id: node.id,
      pane: node.dataset?.pane,
      hidden: node.hidden,
      collapsed: node.collapsed,
      open: node.open,
      internalCollapsed: node._collapsed,
      initialized: node.initialized,
      tabType: node.tabType,
      sectionOpen: node._section?.open,
      display: style.display,
      visibility: style.visibility,
      box: { x: box.x, y: box.y, width: box.width, height: box.height },
      childCount: node.childElementCount,
      scrollTop: node.scrollTop,
      scrollHeight: node.scrollHeight,
      clientHeight: node.clientHeight,
      overflowY: style.overflowY,
      scrollBehavior: style.scrollBehavior,
      children:
        depth < 4 ? [...node.children].slice(0, 40).map((child) => describe(child, depth + 1)) : [],
    };
  };
  let index = 0;
  for (const window of Services.wm.getEnumerator(null)) {
    if (!window.document || window.closed) continue;
    const entry = {
      title: window.document.title,
      url: window.location.href,
      selectedTab: window.Zotero_Tabs?.selectedID,
      selectedType: window.Zotero_Tabs?.selectedType,
      contextCollapsed: window.ZoteroContextPane?.collapsed,
      selectedPanel: window.document.querySelector('#zotero-context-pane-item-deck')?.selectedPanel
        ?.id,
      structures: [
        ...window.document.querySelectorAll(
          '#zotero-context-pane, item-pane-custom-section, .rc-panel, .rc-settings',
        ),
      ].map((node) => describe(node)),
    };
    try {
      entry.screenshot = `${prefix}-${index++}.png`;
      await saveWindow(environment, window, PathUtils.join(directory, entry.screenshot));
    } catch (failure) {
      entry.screenshotFailure = captureFailure(failure, 'diagnostic-screenshot');
    }
    report.windows.push(entry);
  }
  await IOUtils.writeJSON(PathUtils.join(directory, `${prefix}.json`), report);
  return `${prefix}.json`;
}
