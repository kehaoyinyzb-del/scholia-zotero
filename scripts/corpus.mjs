import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';

const root = resolve(import.meta.dirname, '..');
const directory = join(root, '.zotero-dev/corpus');
await mkdir(directory, { recursive: true });
const sources = JSON.parse(await readFile(join(root, 'e2e/corpus-sources.json'), 'utf8'));
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const manifest = [];
for (const entry of sources) {
  const path = join(directory, entry.filename);
  let bytes;
  try {
    bytes = await readFile(path);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (!bytes || digest(bytes) !== entry.sha256) {
    const response = await fetch(entry.pdfURL);
    if (!response.ok) throw new Error(`${entry.id}: HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
    if (digest(bytes) !== entry.sha256)
      throw new Error(
        `${entry.id}: source changed; review its PDF, hash and selected page before acceptance.`,
      );
    await writeFile(path + '.tmp', bytes);
    await rename(path + '.tmp', path);
  }
  manifest.push({ ...entry, path });
  process.stdout.write(`${entry.id}: verified ${entry.sha256}\n`);
}
await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
