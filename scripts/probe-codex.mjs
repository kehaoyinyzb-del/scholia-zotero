import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { JsonRpcClient } from '../src/providers/json-rpc.js';
import { codexArguments, initializeCodex, runCodexTurn } from '../src/providers/codex.js';
import { errorFeedback } from '../src/domain/errors.js';

const executable =
  '/Applications/ChatGPT.app/Contents/Resources/' + 'codex-cli/CodexCLI.app/Contents/MacOS/codex';
const directory = resolve('.zotero-dev/codex-probe');
await mkdir(directory, { recursive: true });
const processHandle = spawn(executable, codexArguments, {
  cwd: directory,
  stdio: ['pipe', 'pipe', 'pipe'],
});
const client = new JsonRpcClient((text) => processHandle.stdin.write(text));
processHandle.stdout.setEncoding('utf8');
processHandle.stdout.on('data', (chunk) => client.receive(chunk));
// Do not persist CLI stderr, account information, thread identifiers or configuration.
processHandle.stderr.resume();
processHandle.on('exit', () => client.close());
processHandle.on('error', () => client.close());
const evidence = { time: new Date().toISOString(), initialized: false, modelCall: 'not-run' };
const interruptTest = process.argv.includes('--interrupt');
try {
  await initializeCodex(client);
  evidence.initialized = true;
  if (process.argv.includes('--model')) {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
      setTimeout(() => processHandle.kill(), 3000);
    }, 45000);
    let deltas = 0;
    if (interruptTest) {
      client.onNotification((method) => {
        if (method === 'turn/started') controller.abort();
      });
    }
    try {
      const answer = await runCodexTurn(
        client,
        {
          messages: [
            { role: 'system', content: 'Only answer the provided text. Do not use tools.' },
            {
              role: 'user',
              content: interruptTest
                ? 'Count from one to one thousand.'
                : 'Reply exactly CONNECTION_OK.',
            },
          ],
          images: [],
        },
        {
          directory,
          provider: { model: '' },
          signal: controller.signal,
          onText: () => {
            deltas += 1;
          },
        },
      );
      evidence.modelCall = answer.trim() === 'CONNECTION_OK' ? 'passed' : 'unexpected-output';
      evidence.streamDeltas = deltas;
    } finally {
      clearTimeout(timer);
    }
  }
} catch (error) {
  evidence.error = errorFeedback(error, 'codex').code;
  if (interruptTest && evidence.error === 'cancelled') evidence.interruption = 'passed';
} finally {
  client.close();
  processHandle.kill();
}
const output = interruptTest ? 'docs/codex-interrupt.json' : 'docs/codex-probe.json';
await writeFile(resolve(output), JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify(evidence));
