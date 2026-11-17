"""Enforce the agreed source line width, including Python build scripts."""
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
failures = []
for name in ['eslint.config.js', 'package.json', '.prettierrc.json']:
    for number, line in enumerate((ROOT / name).read_text().splitlines(), 1):
        if len(line) > 100:
            failures.append(f'{name}:{number} has {len(line)} columns')
for directory in ['src', 'tests', 'scripts', 'browser', 'addon', 'e2e']:
    for file in (ROOT / directory).rglob('*'):
        if file.suffix not in {'.js', '.mjs', '.py', '.css'}:
            continue
        for number, line in enumerate(file.read_text().splitlines(), 1):
            if len(line) > 100 and 'https://' not in line:
                failures.append(f'{file.relative_to(ROOT)}:{number} has {len(line)} columns')
if failures:
    print('\n'.join(failures))
    sys.exit(1)
print('Source line widths are within 100 columns.')
