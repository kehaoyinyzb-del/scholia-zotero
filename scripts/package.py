"""Deterministic archive timestamps and paths make rebuilds byte-identical."""
from pathlib import Path
import hashlib
import json
import zipfile

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / 'dist'
DIST.mkdir(exist_ok=True)


def package(source, output, overrides=None):
    overrides = overrides or {}
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
        for file in sorted(source.rglob('*')):
            if not file.is_file() or file.name.startswith('.'):
                continue
            name = file.relative_to(source).as_posix()
            entry = zipfile.ZipInfo(name, (2026, 11, 14, 0, 0, 0))
            entry.compress_type = zipfile.ZIP_DEFLATED
            entry.external_attr = 0o644 << 16
            archive.writestr(entry, overrides.get(name, file.read_bytes()))
        if source == ROOT / 'browser':
            entry = zipfile.ZipInfo('LICENSE', (2026, 11, 14, 0, 0, 0))
            entry.compress_type = zipfile.ZIP_DEFLATED
            entry.external_attr = 0o644 << 16
            archive.writestr(entry, (ROOT / 'LICENSE').read_bytes())
    return hashlib.sha256(output.read_bytes()).hexdigest()


artifacts = {}
version = json.loads((ROOT / 'package.json').read_text())['version']
addon_name = f'scholia-{version}.xpi'
artifacts[addon_name] = package(ROOT / '.zotero-dev/build/addon', DIST / addon_name)
manifest = json.loads((ROOT / 'browser/manifest.json').read_text())
manifest['version'] = '0.3.0'
chromium_name = 'scholia-browser-chromium-0.3.0.zip'
artifacts[chromium_name] = package(ROOT / 'browser', DIST / chromium_name, {
    'manifest.json': json.dumps(manifest, ensure_ascii=False, indent=2).encode(),
})
manifest['background'] = {'scripts': ['background.js']}
manifest['browser_specific_settings'] = {
    'gecko': {'id': 'reading-companion-browser@local', 'strict_min_version': '128.0'},
}
firefox_name = 'scholia-browser-firefox-0.3.0.zip'
artifacts[firefox_name] = package(ROOT / 'browser', DIST / firefox_name, {
    'manifest.json': json.dumps(manifest, ensure_ascii=False, indent=2).encode(),
})
checksums = ''.join(f'{digest}  {name}\n' for name, digest in artifacts.items())
(DIST / 'SHA256SUMS').write_text(checksums)
for name, digest in artifacts.items():
    print(name, digest)
