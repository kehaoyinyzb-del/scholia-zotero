"""Reproduce the redistributable ECDICT subset from a pinned, checksum-verified CSV."""
from pathlib import Path
import csv
import hashlib
import json
import urllib.request

root = Path(__file__).resolve().parents[1]
cache = root / '.zotero-dev/phase4-assets'
cache.mkdir(parents=True, exist_ok=True)
commit = '39cfb9672c0906b63569e0453c2e6abfb9ab182a'
base = f'https://raw.githubusercontent.com/skywind3000/ECDICT/{commit}/'
checksums = {
    'ecdict.csv': 'd1ecbdf9ee2b920afb6f430ca6b6bb9f559588cf0dff86e04bd255f9390843cc',
    'LICENSE': 'f8552dd246f61a4e064569eae6194a01c6b3d63b03bf27c6ca863593c549ed0f',
}
for name, checksum in checksums.items():
    target = cache / name
    if not target.exists():
        with urllib.request.urlopen(base + name, timeout=120) as response:
            contents = response.read()
        if hashlib.sha256(contents).hexdigest() != checksum:
            raise ValueError('Downloaded source checksum mismatch: ' + name)
        target.write_bytes(contents)
    if hashlib.sha256(target.read_bytes()).hexdigest() != checksum:
        raise ValueError('Local source checksum mismatch: ' + name)
required = {'assert', 'latch', 'right', 'significant', 'consideration',
            'whisker', 'basis', 'regression'}
entries = []
with (cache / 'ecdict.csv').open(newline='') as handle:
    for row in csv.DictReader(handle):
        frequent = (0 < int(row['bnc'] or 0) <= 20000 or 0 < int(row['frq'] or 0) <= 20000)
        if row['translation'] and (frequent or row['word'] in required):
            fields = ['word', 'phonetic', 'translation', 'exchange']
            entries.append({key: row[key] for key in fields})
entries.sort(key=lambda row: row['word'])
output = root / 'addon/dictionaries'
output.mkdir(exist_ok=True)
data = {'sourceCommit': commit, 'sourceSha256': checksums['ecdict.csv'], 'entries': entries}
serialized = json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n'
(output / 'ecdict.json').write_text(serialized)
(output / 'ECDICT-LICENSE.txt').write_bytes((cache / 'LICENSE').read_bytes())
print(f'{len(entries)} entries; {(output / "ecdict.json").stat().st_size} bytes')
