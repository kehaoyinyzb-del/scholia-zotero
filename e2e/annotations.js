import { layouts, setLayout } from './screenshots.js';

export async function runAnnotationAcceptance(context) {
  const { environment, reader, panel, window, root, translated, case_, until, assert } = context;
  const { Zotero, IOUtils, PathUtils } = environment;
  const attachment = Zotero.Items.get(reader.itemID);
  await setLayout(environment, window, panel, layouts[0], context.wait);
  const annotations = () => attachment.getAnnotations();
  const color = async (index) => {
    const before = new Set(annotations().map((item) => item.id));
    const button = root().closest('.selection-popup').querySelectorAll('.color-button')[index];
    assert(button, 'Native Zotero highlight color exists');
    button.click();
    return until(() => annotations().find((item) => !before.has(item.id)), 'New native annotation');
  };
  const commentSetting = async (enabled) => {
    panel.querySelector('[aria-label="更多"]').click();
    [...panel.querySelectorAll('button')].find((node) => node.textContent === '模型设置').click();
    const preferences = await until(
      () =>
        [...environment.Services.wm.getEnumerator('zotero:pref')].find((entry) =>
          entry.document.querySelector('.rc-settings'),
        ),
      'Annotation preferences',
    );
    const settings = preferences.document.querySelector('.rc-settings');
    const label = [...settings.querySelectorAll('label')].find((node) =>
      node.textContent.includes('高亮评论中保存译文'),
    );
    label.querySelector('input').checked = enabled;
    label
      .querySelector('input')
      .dispatchEvent(new label.ownerDocument.defaultView.Event('change', { bubbles: true }));
    await until(() => settings.textContent.includes('已自动应用'), 'Comment setting saved');
    preferences.close();
    window.focus();
    await context.wait(500);
  };
  let original;
  await case_('annotation-setting-off-preserves-native', async () => {
    await commentSetting(false);
    await translated('assert');
    original = await color(0);
    await context.wait(300);
    assert(!original.annotationComment, 'Disabled switch leaves native comment empty');
    assert(!original.hasTag('Scholia'), 'Unchanged native annotation has no plugin tag');
    await commentSetting(true);
    return { key: original.key, comment: original.annotationComment };
  });
  await case_('annotation-native-color-comment', async () => {
    const response = await translated('The source shall not change DATA for 3 cycles.');
    const item = await color(1);
    const pending = Zotero['reading-companion@local'].annotations.pending;
    context.report.annotationMatch = {
      expected: pending?.annotation,
      actual: JSON.parse(item.annotationPosition),
      pending: Boolean(pending),
    };
    await context.persist();
    await until(
      () => item.annotationComment === response.translation,
      'Translation in native comment',
      10000,
    );
    assert(item.hasTag('Scholia'), 'Linked annotation carries plugin tag');
    assert(item.annotationColor !== original.annotationColor, 'Chosen native color is preserved');
    assert(item.annotationType === 'highlight', 'Standard highlight type');
    assert(!original.annotationComment, 'Previous native annotation remains unchanged');
    return { key: item.key, color: item.annotationColor, comment: item.annotationComment };
  });
  await case_('annotation-highlight-and-follow', async () => {
    const response = await translated('A latch stores a bit while its enable input is inactive.');
    const before = annotations().length;
    root().querySelector('[aria-label="标注并追问"]').click();
    await until(
      () => annotations().length === before + 1,
      'Highlight-and-follow creates annotation',
    );
    await until(
      () => panel.querySelector('textarea').value.includes(response.translation),
      'Highlight-and-follow carries source and translation',
    );
    const item = annotations().find((entry) => entry.annotationText === response.selected);
    assert(
      item.annotationComment === response.translation && item.hasTag('Scholia'),
      'Created highlight contains translated comment and tag',
    );
    await context.matrix('annotation-follow');
    return { key: item.key, comment: item.annotationComment };
  });
  await case_('annotation-verified-citation', async () => {
    // Dismiss the selection with native mouse input, then ask through the visible composer.
    const frame = reader._internalReader._primaryView._iframeWindow;
    const utility = environment.Components.utils.unwaiveXrays(frame).windowUtils;
    for (const type of ['mousedown', 'mouseup']) {
      utility.sendMouseEvent(type, frame.innerWidth - 30, frame.innerHeight - 30, 0, 1, 0);
    }
    await context.wait(300);
    await context.submit(
      'annotation-answer',
      '请改用当前页说明 DATA 在 3 个周期内能否改变。引用原文完整短句作为出处。',
      'ask',
      layouts[0],
    );
    const before = annotations().length;
    const button = await until(
      () =>
        [...panel.querySelectorAll('.rc-tooltip button')].find(
          (node) => node.textContent === '在原文中标出',
        ),
      'Verified citation highlight action',
    );
    button.closest('.rc-reference').querySelector('.rc-citation').focus();
    button.click();
    await until(
      () => annotations().length === before + 1,
      'Citation creates exact native highlight',
    );
    const turn = (await context.readSession()).turns.at(-1);
    const item = annotations().find(
      (entry) => entry.annotationComment === turn.answer.claims[0].text,
    );
    assert(item && item.hasTag('Scholia'), 'Citation highlight comment equals supported claim');
    assert(JSON.parse(item.annotationPosition).pageIndex === 0, 'Citation points to correct page');
    await context.matrix('annotation-citation');
    return { key: item.key, text: item.annotationText, position: item.annotationPosition };
  });
  const results = annotations().map((item) => ({
    key: item.key,
    parentID: item.parentID,
    type: item.annotationType,
    text: item.annotationText,
    comment: item.annotationComment,
    color: item.annotationColor,
    position: JSON.parse(item.annotationPosition),
    tags: item.getTags(),
  }));
  await IOUtils.writeJSON(PathUtils.join(context.config.runDirectory, 'annotations.json'), results);
}
