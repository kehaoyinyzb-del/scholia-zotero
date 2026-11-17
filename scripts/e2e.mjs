import { createWriteStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { finished } from 'node:stream/promises';
import { redactDiagnostic } from '../src/domain/diagnostics.js';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, copyFile, access, cp, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { build } from 'esbuild';

const repository = resolve(import.meta.dirname, '..');
const arguments_ = process.argv.slice(2).flatMap((argument) => {
  return argument.startsWith('--') && /\s/u.test(argument)
    ? argument.trim().split(/\s+/u)
    : [argument];
});
const option = (name, fallback) => {
  const inline = arguments_.find((value) => value.startsWith(name + '='));
  if (inline) return inline.slice(name.length + 1);
  const index = arguments_.indexOf(name);
  return index === -1 ? fallback : arguments_[index + 1];
};
const scenario = option('--scenario', null);
if (scenario && scenario !== 'real-login') throw new Error('Unknown scenario: ' + scenario);
if (scenario && option('--seed', null)) throw new Error('Real login requires a fresh profile.');
const packageInfo = JSON.parse(await readFile(join(repository, 'package.json'), 'utf8'));
const candidate = resolve(
  option(
    '--xpi',
    join(
      repository,
      option('--only', null) === 'phase10-upgrade-seed'
        ? 'dist/reading-companion-0.8.0.xpi'
        : `dist/scholia-${packageInfo.version}.xpi`,
    ),
  ),
);
const executable = option('--zotero', '/Applications/Zotero.app/Contents/MacOS/zotero');
const timestamp = new Date().toISOString().replace(/[:.]/gu, '-');
const runDirectory = join(repository, '.zotero-dev/e2e', `${timestamp}-${process.pid}`);
const profile = join(runDirectory, 'profile');
const data = join(runDirectory, 'data');
const extensions = join(profile, 'extensions');
await mkdir(extensions, { recursive: true });
await mkdir(data);
await mkdir(join(runDirectory, 'screenshots'));
const seedName = option('--seed', null);
let continuity;
const legacySessions = [];
const inheritedPreferences = {};
if (seedName) {
  if (!/^[\dTZ-]+-\d+$/u.test(seedName)) throw new Error('Seed must name an owned e2e run.');
  const seed = join(repository, '.zotero-dev/e2e', seedName);
  const previous = JSON.parse(await readFile(join(seed, 'launcher.json'), 'utf8'));
  if (previous.groupAlive !== false) throw new Error('Seed instance must have exited.');
  await cp(join(seed, 'data'), data, {
    recursive: true,
    filter: (path) => !path.includes('codex-runtime') && !path.includes('codex-home'),
  });
  // Only the owned isolated seed profile; preserve Login Manager encryption and records.
  for (const name of ['key4.db', 'logins.json']) {
    try {
      await cp(join(seed, 'profile', name), join(profile, name));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  const preferencesText = await readFile(join(seed, 'profile/prefs.js'), 'utf8');
  for (const line of preferencesText.split('\n')) {
    const match = line.match(/^user_pref\(("extensions\.readingCompanion\.[^"]+"), (.*)\);$/u);
    if (match) inheritedPreferences[JSON.parse(match[1])] = JSON.parse(match[2]);
  }
  for (const name of await readdir(join(data, 'reading-companion'))) {
    if (!/^session-.*\.json$/u.test(name)) continue;
    const session = JSON.parse(await readFile(join(data, 'reading-companion', name), 'utf8'));
    legacySessions.push({
      documentId: session.documentId,
      turns: session.turns.map((turn) => turn.id),
      glossary: session.glossary,
    });
  }
  if (option('--only', null) === 'phase6-tail') {
    const candidates = [];
    for (const entry of legacySessions) {
      const session = JSON.parse(
        await readFile(join(data, 'reading-companion', `session-${entry.documentId}.json`), 'utf8'),
      );
      if (session.notebookDraft) candidates.push(session);
    }
    candidates.sort((a, b) =>
      b.notebookDraft.generatedAt.localeCompare(a.notebookDraft.generatedAt),
    );
    const session = candidates[0];
    continuity = {
      documentId: session.documentId,
      count: session.turns.length,
      first: session.turns[0].id,
    };
  }
  if (option('--only', null) === 'phase6-math-view') {
    for (const entry of legacySessions) {
      const session = JSON.parse(
        await readFile(join(data, 'reading-companion', `session-${entry.documentId}.json`), 'utf8'),
      );
      if (session.turns.some((turn) => turn.question.includes('Y=PX'))) {
        continuity = {
          documentId: session.documentId,
          count: session.turns.length,
          first: session.turns[0].id,
        };
        break;
      }
    }
  }
  if (option('--only', null) === 'phase6-restart')
    continuity = JSON.parse(await readFile(join(seed, 'continuity.json'), 'utf8'));
}

async function choosePort() {
  const specified = option('--port', null);
  for (let port = specified ? Number(specified) : 24119; port < 24220; port++) {
    if (!Number.isInteger(port) || port < 1024 || [23119, 23147].includes(port)) {
      throw new Error('The e2e port must be isolated from production and independent QA.');
    }
    const server = createServer();
    const available = await new Promise((resolve) => {
      server.once('error', () => resolve(false));
      server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
    });
    if (available) return port;
    if (specified) throw new Error('Requested e2e port is occupied.');
  }
  throw new Error('No free e2e port.');
}

const port = await choosePort();
const candidateBytes = await readFile(candidate);
const checksum = createHash('sha256').update(candidateBytes).digest('hex');
await copyFile(candidate, join(extensions, 'reading-companion@local.xpi'));
const preferences = {
  ...inheritedPreferences,
  'extensions.zotero.dataDir': data,
  'extensions.zotero.useDataDir': true,
  'extensions.zotero.httpServer.port': port,
  'extensions.zotero.httpServer.enabled': true,
  'extensions.zotero.firstRun2': false,
  'extensions.zotero.sync.autoSync': false,
  'extensions.autoDisableScopes': 0,
  'extensions.enabledScopes': 15,
  'extensions.update.enabled': false,
  'app.update.auto': false,
  'toolkit.telemetry.enabled': false,
};
await writeFile(
  join(profile, 'user.js'),
  Object.entries(preferences)
    .map(([key, value]) => {
      return `user_pref(${JSON.stringify(key)}, ${JSON.stringify(value)});`;
    })
    .join('\n'),
);
const corpus = [
  'corpus',
  'phase6-corpus',
  'phase6-word',
  'phase7-summary',
  'phase7-text',
  'phase11',
].includes(option('--only', null))
  ? JSON.parse(await readFile(join(repository, '.zotero-dev/corpus/manifest.json'), 'utf8')).filter(
      (entry) =>
        !option('--material', null) || option('--material', '').split(',').includes(entry.id),
    )
  : [];
if (
  ['corpus', 'phase6-corpus', 'phase6-word', 'phase7-summary', 'phase7-text', 'phase11'].includes(
    option('--only', null),
  ) &&
  !corpus.length
) {
  throw new Error('No matching corpus material.');
}
for (const entry of corpus) {
  const digest = createHash('sha256')
    .update(await readFile(entry.path))
    .digest('hex');
  if (digest !== entry.sha256) throw new Error('Corpus PDF checksum mismatch: ' + entry.id);
}
const checkEmptyStates = !scenario && (!option('--only', null) || option('--only', null) === 'ui');
if (checkEmptyStates) execFileSync('python3', [join(repository, 'scripts/scan-fixture.py')]);
const config = {
  runDirectory,
  data,
  port,
  checksum,
  failFast: arguments_.includes('--fail-fast'),
  only: scenario || option('--only', 'phase6-full'),
  views: option('--views', null),
  layouts: option('--layouts', null),
  scale: option('--scale', null),
  loginTimeout: Number(option('--login-timeout', 600)) * 1000,
  corpus,
  codexFixture: option(
    '--codex-fixture',
    join(repository, '.zotero-dev/managed-codex/codex-aarch64-apple-darwin'),
  ),
  legacySessions,
  continuity,
  inheritedConfiguration: inheritedPreferences['extensions.readingCompanion.configuration.v2'],
  fixtures: [
    { name: 'IC acceptance', path: join(repository, 'samples/digital-ic-spec.pdf') },
    { name: 'Library acceptance', path: join(repository, 'samples/library-study.pdf') },
    { name: 'Selection acceptance', path: join(repository, 'samples/selection-translation.pdf') },
    ...corpus,
    ...(checkEmptyStates
      ? [{ name: 'Raster acceptance', path: join(repository, '.zotero-dev/scan-fixture.pdf') }]
      : []),
  ],
};
for (const fixture of config.fixtures) await access(fixture.path);
const helper = join(runDirectory, 'helper');
await mkdir(helper);
await writeFile(
  join(helper, 'manifest.json'),
  JSON.stringify({
    manifest_version: 2,
    name: 'Reading Companion isolated acceptance driver',
    version: '1.0',
    applications: {
      zotero: {
        id: 'reading-companion-e2e@local',
        update_url: 'https://e2e.invalid/updates.json',
        strict_min_version: '10.0',
        strict_max_version: '10.*',
      },
    },
  }),
);
await build({
  entryPoints: [join(repository, 'e2e/driver.js')],
  bundle: true,
  format: 'iife',
  globalName: 'AcceptanceDriver',
  target: 'firefox140',
  outfile: join(helper, 'driver.js'),
});
const bootstrap = await readFile(join(repository, 'e2e/bootstrap.js'), 'utf8');
await writeFile(
  join(helper, 'bootstrap.js'),
  `var acceptanceConfig = ${JSON.stringify(config)};\n${bootstrap}`,
);
execFileSync('python3', [
  '-m',
  'zipfile',
  '-c',
  join(extensions, 'reading-companion-e2e@local.xpi'),
  ...['manifest.json', 'bootstrap.js', 'driver.js'].map((name) => join(helper, name)),
]);
const commandArguments = ['-no-remote', '-profile', profile, '-datadir', data, '-ZoteroDebugText'];
const launcher = {
  timestamp,
  candidate,
  checksum,
  profile,
  data,
  port,
  command: [executable, ...commandArguments],
  status: 'prepared',
  productModified: false,
};
const launcherPath = join(runDirectory, 'launcher.json');
const save = () => writeFile(launcherPath, JSON.stringify(launcher, null, 2) + '\n');
await save();
console.log(`E2E evidence: ${runDirectory}`);
if (scenario) console.log('请在隔离 Zotero 点登录并完成浏览器授权，脚本随后自动提问并退出。');
if (!arguments_.includes('--prepare-only')) {
  const child = spawn(executable, commandArguments, {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  launcher.pid = child.pid;
  launcher.status = 'running';
  const logs = [];
  const logReaders = [];
  for (const [name, pipe] of [
    ['stdout', child.stdout],
    ['stderr', child.stderr],
  ]) {
    const output = createWriteStream(join(runDirectory, `zotero-${name}.log`), { mode: 0o600 });
    const lines = createInterface({ input: pipe });
    lines.on('line', (line) => output.write(redactDiagnostic(line) + '\n'));
    logs.push(output);
    logReaders.push(lines);
  }
  const deadline = setTimeout(
    () => {
      launcher.timedOut = true;
      requestStop();
    },
    Number(option('--timeout', 1200)) * 1000,
  );
  const terminate = (signal) => {
    if (!child.pid) return;
    try {
      process.kill(-child.pid, signal);
    } catch {}
  };
  const requestStop = () => {
    writeFile(join(runDirectory, 'stop-request'), 'Stop isolated acceptance.\n').catch((error) => {
      launcher.stopRequestError = error.code;
    });
  };
  const interrupt = () => {
    launcher.interrupted = true;
    requestStop();
  };
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  let hardStop;
  child.once('spawn', () => save());
  const watchdog = setInterval(async () => {
    if (!launcher.timedOut && !launcher.interrupted) {
      try {
        await access(join(runDirectory, 'stop-request'));
        launcher.interrupted = true;
      } catch {}
    }
    if ((launcher.timedOut || launcher.interrupted) && !hardStop) {
      hardStop = setTimeout(() => terminate('SIGKILL'), 8000);
    }
  }, 500);
  const result = await new Promise((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
    child.once('error', (error) => resolve({ code: null, spawnError: error.code }));
  });
  clearTimeout(deadline);
  clearInterval(watchdog);
  clearTimeout(hardStop);
  terminate('SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, 500));
  terminate('SIGKILL');
  let groupAlive = false;
  for (let attempt = 0; child.pid && attempt < 30; attempt++) {
    try {
      process.kill(-child.pid, 0);
      groupAlive = true;
    } catch {
      groupAlive = false;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  process.removeListener('SIGINT', interrupt);
  process.removeListener('SIGTERM', interrupt);
  Object.assign(launcher, result, { groupAlive });
  let report;
  try {
    report = JSON.parse(await readFile(join(runDirectory, 'report.json'), 'utf8'));
  } catch {}
  launcher.status =
    report?.status === 'passed' &&
    result.code === 0 &&
    !result.signal &&
    !launcher.timedOut &&
    !launcher.interrupted &&
    !groupAlive
      ? 'passed'
      : 'failed';
  if (!report) {
    launcher.status = 'blocked-before-report';
    launcher.startupLog = 'zotero-stderr.log';
  }
  try {
    const installedHash = createHash('sha256')
      .update(await readFile(join(extensions, 'reading-companion@local.xpi')))
      .digest('hex');
    launcher.installedBytesUnchanged = installedHash === checksum;
    if (!launcher.installedBytesUnchanged) launcher.status = 'failed';
  } catch (error) {
    if (
      error.code !== 'ENOENT' ||
      config.only !== 'phase10-upgrade' ||
      !report.expectedUninstall ||
      report.beforeUninstallChecksum !== checksum
    )
      throw error;
    launcher.installedRemovedByAcceptance = true;
    launcher.bytesVerifiedBeforeUninstall = true;
  }
  launcher.candidateBytesUnchanged =
    createHash('sha256')
      .update(await readFile(candidate))
      .digest('hex') === checksum;
  if (!launcher.candidateBytesUnchanged) launcher.status = 'failed';
  for (const reader of logReaders) reader.close();
  for (const output of logs) output.end();
  await Promise.all(logs.map((output) => finished(output)));
  await save();
  if (report) {
    execFileSync('python3', [join(repository, 'scripts/e2e-review.py'), runDirectory], {
      stdio: 'inherit',
    });
  }
  console.log(
    JSON.stringify({
      status: launcher.status,
      code: result.code,
      signal: result.signal,
      groupAlive,
      report: join(runDirectory, 'report.json'),
    }),
  );
  process.exitCode = launcher.status === 'passed' ? 0 : 1;
}
