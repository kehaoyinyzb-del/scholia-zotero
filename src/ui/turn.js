import { element, action } from './dom.js';
import { collapsibleText } from './collapsible.js';
import { iconAction } from './icons.js';
import { renderRichText, renderTableTranslation, typesetText } from './rich-text.js';
import { describePage } from '../domain/evidence.js';

function citationReferences(document, turn, claim, callbacks, pageNumbers) {
  const groups = new Map();
  for (const citation of claim.citations) {
    if (!pageNumbers.has(citation.pageIndex))
      pageNumbers.set(citation.pageIndex, pageNumbers.size + 1);
    const group = groups.get(citation.pageIndex) || [];
    if (!group.some((entry) => entry.quote === citation.quote)) group.push(citation);
    groups.set(citation.pageIndex, group);
  }
  const entries = [...groups].sort((a, b) => pageNumbers.get(a[0]) - pageNumbers.get(b[0]));
  if (!entries.length) return [];
  const [pageIndex, group] = entries[0];
  const description = entries
    .map(
      ([page, citations]) =>
        describePage(page, citations[0].printedPage) +
        '\n' +
        citations
          .map((citation) =>
            citation.verifiedQuote
              ? citation.quote
              : `未在原文中逐字找到，可搜索：${citation.quote}`,
          )
          .join('\n'),
    )
    .join('\n');
  const wrapper = element(document, 'span', null, { class: 'rc-reference' });
  wrapper.append(
    action(
      document,
      `p.${pageIndex + 1}${group.every((entry) => entry.verifiedQuote) ? '' : '?'}`,
      () => callbacks.navigate(turn.snapshot, group[0]),
      {
        class:
          'rc-citation' + (group.every((entry) => entry.verifiedQuote) ? '' : ' rc-unverified'),
        title: description,
        'aria-label': `出处 ${pageNumbers.get(pageIndex)}：${description}`,
      },
    ),
  );
  const tip = element(document, 'span', null, { class: 'rc-tooltip' });
  for (const [page, citations] of entries) {
    for (const citation of citations) {
      tip.append(
        action(
          document,
          `第 ${page + 1} 页 · ${citation.quote}`,
          () => callbacks.navigate(turn.snapshot, citation),
          { class: 'rc-source-excerpt' },
        ),
      );
      if (citation.verifiedQuote && citation.position && callbacks.highlight)
        tip.append(
          action(document, '在原文中标出', () => callbacks.highlight(turn, citation, claim)),
        );
    }
  }
  wrapper.append(tip);
  return [wrapper];
}

export function renderTurn(document, turn, callbacks) {
  const root = element(document, 'article', null, {
    class: 'rc-turn',
    'data-turn-id': turn.id,
    'data-state': turn.state,
  });
  const question = element(document, 'div', null, { class: 'rc-user-message' });
  for (const reference of turn.snapshot.references || []) {
    const block = collapsibleText(document, reference.text, 'rc-cite-block', 3, () =>
      callbacks.navigate(turn.snapshot, reference),
    );
    block.append(
      element(
        document,
        'small',
        reference.kind === 'answer' ? '引用回答' : `第 ${reference.pageIndex + 1} 页`,
      ),
    );
    if (reference.originalLength > reference.text.length)
      block.append(
        element(
          document,
          'small',
          `引用保留 ${reference.text.length} 字，` +
            `已截去 ${reference.originalLength - reference.text.length} 字`,
        ),
      );
    question.append(block);
  }
  question.append(
    collapsibleText(document, turn.displayQuestion || turn.question, 'rc-question', 8),
  );
  root.append(question);
  root.dataset.summary = String(Boolean(turn.summary));
  if (turn.state === 'streaming') {
    const stream = element(document, 'div', null, { class: 'rc-stream', 'aria-busy': 'true' });
    if (turn.preview) stream.append(renderRichText(document, turn.preview));
    root.append(stream);
    return root;
  }
  if (!turn.answer) {
    const text = turn.error
      ? `${turn.error.title}。${turn.error.reason}${turn.error.action}`
      : '此轮已停止。可以重新发送。';
    root.append(element(document, 'p', text, { role: 'status' }));
    if (turn.error && callbacks.errorActions) root.append(callbacks.errorActions(turn.error));
    return root;
  }
  const pageNumbers = new Map();
  let citationCount = 0;
  const prose = turn.answer.claims.map((claim) => claim.text).join(' ');
  const sentenceCount = [
    ...new Intl.Segmenter('zh', { granularity: 'sentence' }).segment(prose),
  ].filter((entry) => entry.segment.trim()).length;
  if (!turn.answer.translation) {
    if (!turn.answer.claims.length) root.append(renderRichText(document, turn.answer.text));
    for (const [index, claim] of turn.answer.claims.entries()) {
      const section = element(document, 'div', null, { class: 'rc-claim' });
      const plain = claim.text.replace(/\*\*([^*]+)\*\*/gu, '$1');
      const heading = turn.summary && plain.match(/^([^：:。！？\n]{1,8})[：:]\s*/u);
      const title = turn.summary && (claim.title || heading?.[1]);
      const rich = renderRichText(document, heading ? plain.slice(heading[0].length) : claim.text);
      if (title) section.append(element(document, 'h4', title, { class: 'rc-summary-title' }));
      for (const strong of rich.querySelectorAll('strong'))
        strong.replaceWith(...strong.childNodes);
      const sentence = claim.text
        .replace(/\*\*([^*]+)\*\*/gu, '$1')
        .match(/^[^\n。！？]+[。！？]?/u)?.[0];
      if (!turn.summary && index === 0 && sentenceCount > 3 && sentence?.length <= 40) {
        const first = rich.querySelector('p');
        if (first && first.textContent.startsWith(sentence)) {
          const range = document.createRange();
          const walker = document.createTreeWalker(first, 4);
          let node,
            length = sentence.length;
          range.setStart(first, 0);
          while ((node = walker.nextNode())) {
            if (length <= node.textContent.length) {
              range.setEnd(node, length);
              const strong = element(document, 'strong');
              strong.append(range.extractContents());
              range.insertNode(strong);
              break;
            }
            length -= node.textContent.length;
          }
        }
      }
      section.append(rich);
      if (claim.kind === 'background') {
        // Claims from the model's own knowledge carry no page; a quiet tag marks them.
        const last = [...rich.querySelectorAll('p')].at(-1) || rich;
        last.append(element(document, 'span', '背景', { class: 'rc-background-mark' }));
      }
      if (claim.citations.length && citationCount++ < 8) {
        let anchor = section.querySelector('.rc-prose > p:last-of-type');
        if (!anchor) {
          anchor = element(document, 'p', '表中出处');
          section.prepend(anchor);
        }
        const references = citationReferences(document, turn, claim, callbacks, pageNumbers);
        // Keep the sentence's last characters with its page number so a lone character
        // never wraps onto a line by itself. Text content is unchanged.
        const walker = document.createTreeWalker(anchor, 4);
        let last = null;
        while (walker.nextNode())
          if (walker.currentNode.textContent.trim()) last = walker.currentNode;
        if (references.length && last && last.parentNode === anchor && last.length > 3) {
          const tail = last.splitText(last.length - 3);
          const keep = element(document, 'span', null, { class: 'rc-tail' });
          anchor.insertBefore(keep, tail);
          keep.append(tail, ...references);
        } else anchor.append(...references);
      }
      root.append(section);
    }
    // Preserve structured tables that the prose claims cannot express.
    const rich = renderRichText(document, turn.answer.text);
    const tables = new Set([...root.querySelectorAll('table')].map((table) => table.textContent));
    for (const table of rich.querySelectorAll('.rc-table-scroll')) {
      if (!tables.has(table.textContent)) root.append(table);
      tables.add(table.textContent);
    }
  }
  if (turn.answer.translation) {
    const result = turn.answer.translation;
    for (const row of result.rows) {
      const pair = element(document, 'section', null, {
        class:
          'rc-translation' +
          (row.role === 'heading' ? ' rc-translation-heading' : '') +
          (row.role === 'marginal' ? ' rc-translation-marginal' : ''),
      });
      const table = renderTableTranslation(document, row.original, row.translation);
      if (table) pair.append(table);
      else {
        const original = renderRichText(document, row.original);
        original.classList.add('rc-translation-original');
        original.setAttribute('aria-label', '原文');
        const translation = renderRichText(document, row.translation);
        translation.classList.add('rc-translation-target');
        translation.setAttribute('aria-label', '译文');
        pair.append(original, translation);
      }
      const issues = [...result.globalIssues, ...row.issues];
      if (issues.length) {
        const details = element(document, 'details', null, { class: 'rc-translation-review' });
        details.append(
          element(document, 'summary', '?', {
            title: issues.join('\n'),
            'aria-label': '译文待核对',
          }),
        );
        for (const issue of issues) details.append(element(document, 'p', issue));
        pair.append(details);
      }
      pair.append(
        iconAction(document, '追问这句', 'quote', () => callbacks.followTranslation(turn, row), {
          class: 'rc-icon-button rc-translation-ask',
        }),
      );
      root.append(pair);
    }
  }
  if (turn.answer.followups?.length) {
    const followups = element(document, 'div', null, { class: 'rc-followups' });
    for (const question of turn.answer.followups)
      followups.append(
        action(document, typesetText(question), () => callbacks.followup?.(question), {
          class: 'rc-followup',
        }),
      );
    root.append(followups);
  }
  const controls = element(document, 'div', null, { class: 'rc-turn-actions rc-answer-footer' });
  const model =
    callbacks.modelName?.(turn.provider) ||
    turn.provider.displayName ||
    turn.provider.model ||
    turn.provider.name;
  controls.title = [model, ...turn.answer.uncertainties].filter(Boolean).join('\n');
  if (turn.summary) {
    const coverage = (turn.answer.coverage || turn.scope || '')
      .replace(/已读取|已读/u, '读了')
      .replace('的文本', '的文字，没有读图')
      .replace('页文字（图像未读）', '页的文字，没有读图');
    controls.append(element(document, 'span', coverage, { class: 'rc-answer-coverage' }));
  }
  controls.append(iconAction(document, '复制回答', 'copy', () => callbacks.copy(turn)));
  controls.append(iconAction(document, '存为笔记', 'bookmark', () => callbacks.saveNote(turn)));
  if (turn.summary)
    controls.append(iconAction(document, '重新生成', 'refresh', () => callbacks.regenerate?.()));
  root.append(controls);
  return root;
}
