import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { JsonRpcClient } from '../src/providers/json-rpc.js';
import { codexArguments, initializeCodex, runCodexTurn } from '../src/providers/codex.js';
import { captureEvidence, finalizeEvidence } from '../src/domain/evidence.js';
import { retrieveSources } from '../src/domain/retrieval.js';
import { composeRequest } from '../src/domain/prompt.js';
import { parseAnswer } from '../src/domain/answer.js';
import { providerSignature } from '../src/domain/configuration.js';
import { errorFeedback } from '../src/domain/errors.js';

const directory = resolve('.zotero-dev/fixture-model');
await mkdir(directory, { recursive: true });
const executable =
  '/Applications/ChatGPT.app/Contents/Resources/' + 'codex-cli/CodexCLI.app/Contents/MacOS/codex';
const processHandle = spawn(executable, codexArguments, {
  cwd: directory,
  stdio: ['pipe', 'pipe', 'pipe'],
});
const client = new JsonRpcClient((line) => processHandle.stdin.write(line));
processHandle.stdout.setEncoding('utf8');
processHandle.stdout.on('data', (chunk) => client.receive(chunk));
processHandle.stderr.resume();
processHandle.on('exit', () => client.close());
processHandle.on('error', () => client.close());
const pages = JSON.parse(await readFile('.zotero-dev/fixture-render/pages.json', 'utf8')).map(
  (page) => ({
    ...page,
    paragraphs: [{ id: `p${page.pageIndex + 1}-0`, text: page.text, pageIndex: page.pageIndex }],
  }),
);
const provider = { type: 'codex', name: '本机 Codex', id: 'codex', model: '', context: 64000 };
provider.probe = { signature: providerSignature(provider), text: true, vision: true };
const report = {
  time: new Date().toISOString(),
  environment: 'Node harness using production prompt and app-server modules; not Zotero GUI',
  results: [],
};
try {
  await initializeCodex(client);
  for (const pageIndex of [2, 4]) {
    const image = await readFile(`.zotero-dev/fixture-render/page-${pageIndex + 1}.png`);
    const capture = captureEvidence(
      {
        document: { id: 'synthetic-spec', itemID: 1 },
        pageIndex,
        printedPage: pages[pageIndex].printedPage,
        images: [
          {
            pageIndex,
            dataURL: `data:image/png;base64,${image.toString('base64')}`,
            width: 796,
            height: 1030,
          },
        ],
      },
      `fixture-${pageIndex}`,
    );
    const question = '这张时序图第三拍为什么不能换数据？请核对我的前提，给出图和条款出处。';
    const sources = retrieveSources(pages, capture, question);
    const snapshot = finalizeEvidence(capture, sources, [], `request-${pageIndex}`, {
      totalPages: pages.length,
    });
    const request = composeRequest({ question, snapshot, provider });
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
      setTimeout(() => processHandle.kill(), 3000);
    }, 120000);
    try {
      const raw = await runCodexTurn(client, request, {
        provider,
        directory,
        signal: controller.signal,
      });
      report.results.push({
        filePage: pageIndex + 1,
        evidencePages: snapshot.coverage.filePages,
        imageSHA256: createHash('sha256').update(image).digest('hex'),
        answer: parseAnswer(raw, snapshot),
      });
    } catch (error) {
      report.results.push({ filePage: pageIndex + 1, error: errorFeedback(error, 'codex') });
    } finally {
      clearTimeout(timer);
    }
  }
} catch (error) {
  report.error = errorFeedback(error, 'codex');
} finally {
  client.close();
  processHandle.kill();
}
await writeFile('docs/codex-fixtures.json', JSON.stringify(report, null, 2) + '\n');
console.log(
  JSON.stringify({
    cases: report.results.length,
    failures: report.results.filter((entry) => {
      return Boolean(entry.error);
    }).length,
    error: report.error?.code,
  }),
);
