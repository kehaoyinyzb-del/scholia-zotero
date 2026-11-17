import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { JsonRpcClient } from '../src/providers/json-rpc.js';
import { initializeCodex, codexArguments } from '../src/providers/codex.js';

const directory = resolve('.zotero-dev/phase3-codex');
await mkdir(directory, { recursive: true });
const executable =
  '/Applications/ChatGPT.app/Contents/Resources/' + 'codex-cli/CodexCLI.app/Contents/MacOS/codex';
const child = spawn(executable, codexArguments, { cwd: directory });
const client = new JsonRpcClient((line) => child.stdin.write(line));
child.stdout.setEncoding('utf8');
child.stdout.on('data', (chunk) => client.receive(chunk));
child.stderr.resume();
child.on('exit', () => client.close());
child.on('error', () => client.close());
const timer = setTimeout(() => child.kill(), 20000);
try {
  await initializeCodex(client);
  const result = await client.request('model/list', { limit: 100 });
  const models = result.data.map((model) => ({
    model: model.model,
    description: model.description,
    displayName: model.displayName,
    isDefault: model.isDefault,
    supportedReasoningEfforts: model.supportedReasoningEfforts,
  }));
  await writeFile(resolve(directory, 'models.json'), JSON.stringify(models, null, 2));
  console.log(JSON.stringify(models));
} finally {
  clearTimeout(timer);
  client.close();
  child.kill();
}
