import { auditStyles } from './visual-audit.js';

export const layouts = [
  { theme: 'light', width: 280 },
  { theme: 'light', width: 440 },
  { theme: 'dark', width: 280 },
  { theme: 'dark', width: 440 },
];

export async function setLayout(environment, window, panel, layout, wait) {
  const reader = environment.Zotero.Reader.getByTabID(window.Zotero_Tabs?.selectedID);
  const view = reader?._internalReader?._lastView || reader?._internalReader?._primaryView;
  const viewer = view?._iframeWindow?.PDFViewerApplication?.pdfViewer;
  const anchorPage = viewer ? viewer.currentPageNumber - 1 : null;
  // Gecko's own theme consumer/devtools use this override. Preference updates alone
  // can be superseded by an asynchronously applied window theme after closing Settings.
  window.browsingContext.prefersColorSchemeOverride = layout.theme;
  for (let attempt = 0; attempt < 20; attempt++) {
    if (window.matchMedia('(prefers-color-scheme: dark)').matches === (layout.theme === 'dark'))
      break;
    await wait(100);
  }
  const host = window.document.querySelector('#zotero-context-pane') || panel.parentElement;
  host.style.flex = '0 0 auto';
  host.style.minWidth = '0';
  host.style.maxWidth = 'none';
  let width = layout.width + 48;
  for (let attempt = 0; attempt < 4; attempt++) {
    host.style.width = `${width}px`;
    host.setAttribute('width', String(width));
    await wait(200);
    const measured = panel.getBoundingClientRect().width;
    if (Math.abs(measured - layout.width) < 2) break;
    width += layout.width - measured;
  }
  await wait(200);
  if (reader) {
    // Re-anchor the fixture after a theme/scale change has restored its scroll offset.
    await reader.navigate({ pageIndex: anchorPage });
    let stable = 0;
    for (let attempt = 0; viewer && attempt < 100; attempt++) {
      const page = viewer.getPageView(viewer.currentPageNumber - 1);
      const visible = viewer._getVisiblePages().views;
      const canvases = [...(page?.div?.querySelectorAll('.canvasWrapper canvas') || [])];
      const ready =
        viewer.currentPageNumber - 1 === anchorPage &&
        page?.renderingState === 3 &&
        visible.length &&
        canvases.some((canvas) => canvas.width && canvas.height);
      stable = ready ? stable + 1 : 0;
      if (stable === 3) break;
      await wait(100);
    }
    if (viewer && stable < 3) throw new Error('PDF canvas did not settle after layout change');
  }
  return {
    requested: layout,
    documentFocused: window.document.hasFocus(),
    width: panel.getBoundingClientRect().width,
    dark: window.matchMedia('(prefers-color-scheme: dark)').matches,
    scrollWidth: panel.scrollWidth,
    clientWidth: panel.clientWidth,
    themeMechanism: 'Gecko browsingContext.prefersColorSchemeOverride',
    styleAudit: auditStyles(window, panel),
  };
}

export function hashBytes(environment, bytes) {
  const { classes, interfaces } = environment.Components;
  const hash = classes['@mozilla.org/security/hash;1'].createInstance(interfaces.nsICryptoHash);
  hash.init(hash.SHA256);
  hash.update(bytes, bytes.length);
  return Array.from(hash.finish(false), (character) => {
    return character.charCodeAt(0).toString(16).padStart(2, '0');
  }).join('');
}

export async function saveWindow(environment, window, path, scale = 1) {
  const canvas = window.document.createElementNS('http://www.w3.org/1999/xhtml', 'canvas');
  const browsingContext = window.browsingContext || window.docShell.browsingContext;
  let method;
  if (browsingContext.currentWindowGlobal?.drawSnapshot) {
    const bitmap = await browsingContext.currentWindowGlobal.drawSnapshot(
      undefined,
      scale,
      'white',
    );
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0);
    bitmap.close();
    method = 'WindowGlobalParent.drawSnapshot';
  } else {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const context = canvas.getContext('2d');
    if (!context.drawWindow) throw new Error('Native window screenshot API unavailable');
    context.drawWindow(window, 0, 0, window.innerWidth, window.innerHeight, 'white');
    method = 'privileged-canvas.drawWindow';
  }
  const raw = environment.atob(canvas.toDataURL('image/png').split(',')[1]);
  const bytes = Uint8Array.from(raw, (character) => character.charCodeAt(0));
  await environment.IOUtils.write(path, bytes);
  return {
    method,
    windowWidth: canvas.width,
    windowHeight: canvas.height,
    sha256: hashBytes(environment, bytes),
  };
}
