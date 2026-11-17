import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { OfflineDictionary } from '../src/domain/dictionary.js';
import { cacheIdentity, cacheKey, matchingEntry } from '../src/domain/translation-cache.js';
import { TranslationService } from '../src/runtime/translations.js';
import { documentOccurrences, selectionContextDetails } from '../src/domain/document-context.js';
import { page } from './helpers.js';

const provider = { id: 'codex', name: 'Codex', type: 'codex', model: '', context: 64000 };

test('再分发词典真实子集保留词性与音标，并还原规则和不规则词形', () => {
  const data = JSON.parse(readFileSync('addon/dictionaries/ecdict.json', 'utf8'));
  const dictionary = new OfflineDictionary(data.entries);
  assert.equal(data.entries.length, 23081);
  assert.equal(dictionary.lookup('asserts').lemma, 'assert');
  assert.equal(dictionary.lookup('went').lemma, 'go');
  assert.ok(dictionary.lookup('right').phonetic);
  assert.match(dictionary.lookup('right').meaning, /权利/u);
  assert.ok(dictionary.lookup('significant').partOfSpeech);
  assert.equal(dictionary.lookup('zz-not-a-word'), null);
});

test('缓存按上下文、语言、模型及相关术语区分，哈希碰撞不能伪装命中', () => {
  const source = 'Keep DATA stable.';
  const identity = cacheIdentity({
    source,
    context: source,
    pageIndex: 0,
    provider,
    language: '中文',
    glossary: [],
  });
  const entries = { [cacheKey(identity)]: { identity, translation: '保持 DATA 稳定。' } };
  assert.ok(matchingEntry(entries, { ...identity }));
  assert.equal(matchingEntry(entries, { ...identity, context: 'Other context' }), null);
  const changed = cacheIdentity({
    source,
    context: source,
    pageIndex: 0,
    provider,
    language: '中文',
    glossary: [{ source: 'DATA', translation: '数据' }],
  });
  entries[cacheKey(changed)] = entries[cacheKey(identity)];
  assert.equal(matchingEntry(entries, changed), null);
});

test('文内定义与其他出现保留页码；重复词按选择坐标定位段落', () => {
  const pages = [
    page(0, 'A latch is defined as a storage element.'),
    page(1, 'The latch is closed.'),
  ];
  const occurrences = documentOccurrences(pages, 'latch');
  assert.deepEqual(
    occurrences.map((entry) => entry.pageIndex),
    [0, 1],
  );
  assert.equal(occurrences[0].definition, true);
  const means = documentOccurrences(
    [page(0, 'The means employed do not violate a right.')],
    'right',
  );
  assert.equal(means[0].definition, false);
  const current = page(0, 'right means correct.');
  current.paragraphs.push({
    text: 'A right to privacy is discussed.',
    position: { pageIndex: 0, rects: [[10, 300, 100, 310]] },
  });
  const context = selectionContextDetails({
    pages: [current],
    selected: 'right',
    context: 'A right to privacy is discussed.',
    pageIndex: 0,
    position: { rects: [[10, 300, 30, 310]] },
  });
  assert.match(context.paragraph, /privacy/u);
});

test('持久句缓存重建服务后仍命中；纠正术语只标记相关句过期', async () => {
  const files = new Map();
  const store = {
    read: async (name, fallback) => structuredClone(files.get(name) || fallback),
    write: async (name, value) => files.set(name, structuredClone(value)),
  };
  const application = {
    store,
    recordFailure: (error) => {
      throw error;
    },
  };
  const service = new TranslationService(application);
  const identity = (source) =>
    cacheIdentity({
      source,
      context: source,
      pageIndex: 0,
      provider,
      language: '中文',
      glossary: [],
    });
  await service.saveEntry('doc', identity('Keep DATA stable.'), {
    kind: 'sentence',
    translation: '保持 DATA 稳定。',
  });
  await service.saveEntry('doc', identity('Visit a library.'), {
    kind: 'sentence',
    translation: '去图书馆。',
  });
  const restarted = new TranslationService(application);
  await restarted.load('doc');
  assert.ok(restarted.find('doc', identity('Keep DATA stable.')));
  restarted.invalidate({ documentId: 'doc', glossary: [{ source: 'DATA', translation: '数据' }] });
  assert.equal(restarted.find('doc', identity('Keep DATA stable.')), null);
  assert.ok(restarted.find('doc', identity('Visit a library.')));
  await restarted.close();
});
