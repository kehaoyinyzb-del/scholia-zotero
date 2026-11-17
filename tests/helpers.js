import { captureEvidence, finalizeEvidence } from '../src/domain/evidence.js';

export function view(documentId = '1-EXAMPLE', pageIndex = 1) {
  return {
    document: { id: documentId, itemID: 1, key: 'EXAMPLE', libraryID: 1 },
    pageIndex,
    printedPage: String(pageIndex),
    selection: null,
    visiblePages: [pageIndex],
    images: [{ pageIndex, dataURL: 'data:image/png;base64,aGVsbG8=', width: 1200, height: 800 }],
  };
}

export function page(pageIndex, text) {
  return {
    pageIndex,
    printedPage: String(pageIndex),
    text,
    paragraphs: [
      {
        id: `p${pageIndex + 1}-0`,
        pageIndex,
        text,
        position: { pageIndex, rects: [[10, 10, 100, 20]] },
      },
    ],
  };
}

export const specification = [
  page(0, 'HOLD channel. Source shall keep DATA stable while VALID=1 and READY=0.'),
  page(1, 'Figure 1. HOLD channel at the third rising edge. VALID=1, READY=0, DATA=A.'),
  page(2, 'SAMPLE channel. Source may change DATA while stalled. Acceptance samples DATA.'),
  page(3, 'Figure 2. SAMPLE channel at the third rising edge. The drawing is illustrative.'),
];

export function snapshot() {
  return finalizeEvidence(
    captureEvidence(view(), 'capture'),
    specification.map((entry) => ({
      ...entry,
      id: `page-${entry.pageIndex + 1}`,
      truncated: false,
    })),
    [],
    'snapshot',
    { totalPages: 4 },
  );
}

export function memoryStore() {
  const values = new Map();
  const sessions = new Map();
  return {
    async read(key, fallback) {
      return structuredClone(values.get(key) || fallback);
    },
    async write(key, value) {
      values.set(key, structuredClone(value));
    },
    async session(identifier) {
      if (!sessions.has(identifier)) {
        sessions.set(identifier, { documentId: identifier, turns: [], glossary: [] });
      }
      return sessions.get(identifier);
    },
    async saveSession(session) {
      values.set(session.documentId, structuredClone(session));
    },
    values,
    sessions,
  };
}
