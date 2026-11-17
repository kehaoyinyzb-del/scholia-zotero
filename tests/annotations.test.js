import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quoteAnnotation, sameAnnotationPosition } from '../src/domain/annotation.js';
import { AnnotationService } from '../src/runtime/annotations.js';

test('引文只高亮逐字命中的字符，重复或不匹配引文拒绝创建', () => {
  const chars = [...'Alpha beta gamma.'].map((c, index) => ({
    c,
    rect: [index * 5, 10, index * 5 + 5, 20],
  }));
  const annotation = quoteAnnotation(chars, 'beta', 2, 100);
  assert.deepEqual(annotation.position, { pageIndex: 2, rects: [[30, 10, 50, 20]] });
  assert.equal(annotation.sortIndex, '00002|000006|00080');
  assert.equal(quoteAnnotation(chars, 'delta', 2), null);
  assert.equal(quoteAnnotation([...chars, ...chars], 'beta', 2), null);
  const mathematical = [...'A𝑥B'].map((c, index) => ({ c, rect: [index, 0, index + 1, 1] }));
  assert.deepEqual(quoteAnnotation(mathematical, '𝑥', 0).position.rects, [[1, 0, 2, 1]]);
  assert(
    sameAnnotationPosition(
      { pageIndex: 0, rects: [[1.123456, 2, 3, 4]] },
      { pageIndex: 0, rects: [[1.123, 2, 3, 4]] },
    ),
  );
});

test('仅新建且匹配选区的标注接收译文，已有评论和旧标注不改', async () => {
  const position = { pageIndex: 0, rects: [[1, 2, 3, 4]] };
  const items = [1, 2, 3].map((id) => ({
    id,
    parentID: 10,
    isAnnotation: () => true,
    annotationText: 'assert',
    annotationPosition: JSON.stringify(position),
    annotationComment: id === 2 ? '用户评论' : '',
    addTag(value) {
      this.tag = value;
    },
    async saveTx() {
      this.saved = true;
    },
  }));
  const service = new AnnotationService({
    environment: { Zotero: { Items: { get: (id) => items.find((item) => item.id === id) } } },
    recordFailure: (error) => {
      throw error;
    },
  });
  service.pending = {
    itemID: 10,
    existing: new Set([1]),
    expires: Date.now() + 1000,
    annotation: { text: 'assert', position },
    translation: '置为有效',
  };
  await service.notify('add', 'item', [1, 2, 3]);
  assert.equal(items[0].annotationComment, '');
  assert.equal(items[1].annotationComment, '用户评论');
  assert.equal(items[2].annotationComment, '置为有效');
  assert.equal(items[2].tag, 'Scholia');
  assert.equal(service.pending, null);
});
