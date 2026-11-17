"""Prepare only repository-local Zotero directories. Never read the real profile."""
from pathlib import Path
import json
import shutil

ROOT = Path(__file__).resolve().parents[1]
development = ROOT / '.zotero-dev'
profile = development / 'profile'
data = development / 'data'

for directory in [profile / 'extensions', data]:
    directory.mkdir(parents=True, exist_ok=True)

preferences = {
    'extensions.zotero.dataDir': str(data),
    'extensions.zotero.useDataDir': True,
    'extensions.zotero.httpServer.port': 23129,
    'extensions.zotero.httpServer.enabled': True,
    'extensions.zotero.firstRun2': False,
    'extensions.zotero.sync.autoSync': False,
    'extensions.autoDisableScopes': 0,
    'extensions.enabledScopes': 15,
    'extensions.zotero.reportTranslationFailure': False,
    'toolkit.telemetry.enabled': False,
    'datareporting.healthreport.uploadEnabled': False,
}
profile.joinpath('user.js').write_text('\n'.join(
    f'user_pref({json.dumps(key)}, {json.dumps(value)});'
    for key, value in preferences.items()
) + '\n')

version = json.loads((ROOT / 'package.json').read_text())['version']
shutil.copyfile(
    ROOT / f'dist/reading-companion-{version}.xpi',
    profile / 'extensions/reading-companion@local.xpi',
)
print('Prepared isolated profile and data. Launch only this command:')
print(
    '/Applications/Zotero.app/Contents/MacOS/zotero -no-remote '
    f'-profile "{profile}" -datadir "{data}" -ZoteroDebugText'
)
