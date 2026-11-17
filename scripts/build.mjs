import { build } from 'esbuild';
import { cp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

// Installed-app client identifiers ship with the XPI. Only accept the publisher's
// explicitly supplied desktop client, never API keys or web/service credentials.
let googleClient = null;
if (process.env.SCHOLIA_GOOGLE_OAUTH_CLIENT_FILE) {
  try {
    const config = JSON.parse(await readFile(process.env.SCHOLIA_GOOGLE_OAUTH_CLIENT_FILE, 'utf8'));
    const desktop = config.installed;
    if (
      !/^[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/u.test(desktop?.client_id) ||
      typeof desktop.client_secret !== 'string' ||
      !desktop.client_secret.trim() ||
      typeof desktop.project_id !== 'string' ||
      !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/u.test(desktop.project_id)
    )
      throw new Error();
    googleClient = {
      id: desktop.client_id,
      secret: desktop.client_secret,
      project: desktop.project_id,
    };
  } catch {
    throw new Error('Invalid Scholia Google desktop OAuth client file.');
  }
}
console.log(
  'Bundled Google desktop OAuth client: ' + (googleClient ? 'configured' : 'unconfigured'),
);

await rm('.zotero-dev/build/addon', { recursive: true, force: true });
await mkdir('.zotero-dev/build/addon', { recursive: true });
await cp('addon', '.zotero-dev/build/addon', { recursive: true });
await cp('LICENSE', '.zotero-dev/build/addon/LICENSE');
await writeFile('.zotero-dev/build/addon/google-client.json', JSON.stringify(googleClient));
await build({
  entryPoints: ['src/runtime/application.js'],
  bundle: true,
  format: 'iife',
  globalName: 'ReadingCompanion',
  target: 'firefox140',
  outfile: '.zotero-dev/build/addon/reading-companion.js',
  minify: false,
  legalComments: 'eof',
});
const license = await readFile('node_modules/katex/LICENSE', 'utf8');
const dictionaryLicense = await readFile('addon/dictionaries/ECDICT-LICENSE.txt', 'utf8');
await writeFile(
  '.zotero-dev/build/addon/THIRD-PARTY-LICENSES.txt',
  'KaTeX\n' + license + '\n\nECDICT (pinned subset)\n' + dictionaryLicense,
);
const manifest = JSON.parse(await readFile('addon/manifest.json', 'utf8'));
manifest.version = JSON.parse(await readFile('package.json', 'utf8')).version;
await writeFile('.zotero-dev/build/addon/manifest.json', JSON.stringify(manifest, null, 2));
execFileSync('python3', ['scripts/package.py'], { stdio: 'inherit' });
