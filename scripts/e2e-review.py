"""Build an offline index of original acceptance images; never modify the PNG evidence."""
from pathlib import Path
import html
import json
import sys

root = Path(__file__).resolve().parents[1]
run = Path(sys.argv[1]).resolve()
if not run.is_relative_to(root / '.zotero-dev/e2e'):
    raise ValueError('Review input must be a repository-local acceptance directory')
report = json.loads((run / 'report.json').read_text())
launcher = json.loads((run / 'launcher.json').read_text())
escape = lambda value: html.escape(str(value), quote=True)
labels = {
    'empty': '空状态', 'error': '错误状态', 'settings': '设置',
    'answer-with-citations': '回答与出处', 'translation': '翻译对照',
    'selected': '真实选区', 'streaming': '真实流式文字', 'evidence-choice': '依据点选',
}
parts = ['''<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<title>Scholia实机验收</title><style>
body{font:16px/1.65 system-ui;margin:32px auto;max-width:1400px;padding:0 20px}
a{color:LinkText}code{overflow-wrap:anywhere}img{width:100%;height:auto;display:block}
figure{margin:24px 0 48px}figcaption{margin-bottom:12px}li{margin:4px 0}
details{margin:16px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere}
</style><h1>Scholia · 原样 XPI 实机验收</h1>''']
parts.append(f'<p>范围：{escape(report.get("scope", "full"))}；'
             f'报告：{escape(report["status"])}；启动器：{escape(launcher["status"])}</p>')
parts.append(f'<p>XPI SHA-256：<code>{escape(report["checksum"])}</code></p>')
parts.append('<p><a href="report.json">完整报告</a> · '
             '<a href="launcher.json">启动与退出记录</a> · '
             '<a href="zotero-stdout.log">Zotero 调试日志</a> · '
             '<a href="zotero-stderr.log">标准错误</a></p><ul>')
for case in report['cases']:
    parts.append(f'<li>{escape(case["name"])}：{escape(case["state"])} '
                 f'{escape(case.get("error", ""))}</li>')
parts.append('</ul><h2>实际依据、回答与译文</h2><ul>')
patterns = ['*-evidence.json', '*-answer.md', '*-translation.json', '*note*.html',
            'selection-*.json', 'cold-selection.json', 'annotations.json', 'notebook-*.json',
            '*-term.json', '*-notebook.json', 'source-link-audit.json']
for file in sorted({file for pattern in patterns for file in run.glob(pattern)}):
    parts.append(f'<li><a href="{escape(file.name)}">{escape(file.name)}</a></li>')
parts.append('</ul><h2>原始窗口截图</h2>')
for shot in report['screenshots']:
    name = Path(shot['filename']).name
    title = labels.get(shot['name'], shot['name'])
    layout = shot.get('requested', {'theme': 'unspecified', 'width': 'native'})
    parts.append(f'<figure><figcaption><strong>{escape(title)}</strong> · '
                 f'{escape(layout["theme"])} · {layout["width"]} px · '
                 f'<a href="screenshots/{escape(name)}">{escape(name)}</a><br>'
                 f'快照：<code>{escape(shot.get("modelSnapshotId", ""))}</code>'
                 '</figcaption>')
    parts.append(f'<img loading="lazy" src="screenshots/{escape(name)}" '
                 f'alt="{escape(title)} {escape(layout)}"></figure>')
parts.append('</html>')
(run / 'review.html').write_text('\n'.join(parts))
print(run / 'review.html')
