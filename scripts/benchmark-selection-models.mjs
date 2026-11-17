import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PersistentCodex } from '../src/providers/persistent-codex.js';
import { JsonRpcClient } from '../src/providers/json-rpc.js';
import { codexArguments } from '../src/providers/codex.js';
import { selectionRequest } from '../src/domain/selection.js';

const directory = resolve('.zotero-dev/phase3-codex');
await mkdir(directory, { recursive: true });
const catalog = JSON.parse(await readFile(resolve(directory, 'models.json'), 'utf8'));
const names = ['gpt-6-luna', 'gpt-6-sol', 'gpt-6.1-sol'].filter((name) =>
  catalog.some((model) => model.model === name),
);
const connect = async () => {
  const executable =
    '/Applications/ChatGPT.app/Contents/Resources/' + 'codex-cli/CodexCLI.app/Contents/MacOS/codex';
  const child = spawn(executable, codexArguments, { cwd: directory });
  const client = new JsonRpcClient((line) => child.stdin.write(line));
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => client.receive(chunk));
  child.stderr.resume();
  const exited = new Promise((resolve) =>
    child.once('exit', () => {
      client.close();
      resolve();
    }),
  );
  child.on('error', () => client.close());
  return {
    client,
    pid: child.pid,
    directory,
    close: async () => {
      client.close();
      child.kill();
      await exited;
    },
  };
};
const results = [];
for (const model of names) {
  const pool = new PersistentCodex(connect, () => new AbortController());
  const provider = { type: 'codex', model, path: '' };
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
    pool.close();
  }, 150000);
  try {
    await pool.ensure(provider);
    for (const selected of ['assert', 'assert', 'The source shall not change DATA for 3 cycles.']) {
      const request = selectionRequest({
        selected,
        context:
          'In this digital timing specification, assert means drive a signal active. ' +
          'The source shall not change DATA for 3 cycles.',
        language: '中文',
      });
      const started = Date.now();
      let firstMs;
      const text = await pool.run(provider, request, {
        signal: controller.signal,
        onText: () => {
          firstMs ??= Date.now() - started;
        },
      });
      const row = {
        model,
        selected,
        text,
        firstMs,
        completedMs: Date.now() - started,
        cold: { ...pool.info },
      };
      results.push(row);
      console.log(JSON.stringify(row));
      await writeFile(resolve(directory, 'comparison.json'), JSON.stringify(results, null, 2));
    }
  } catch (error) {
    results.push({ model, error: error.code || error.name });
  } finally {
    clearTimeout(timer);
    await pool.close();
  }
}
await writeFile(resolve(directory, 'comparison.json'), JSON.stringify(results, null, 2));
