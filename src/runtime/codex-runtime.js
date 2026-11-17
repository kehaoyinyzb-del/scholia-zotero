import { codexAssets, codexVersion } from '../domain/codex-release.js';
import { ReadingError } from '../domain/errors.js';

export class CodexRuntime {
  constructor(environment, store, rootURI) {
    this.environment = environment;
    this.store = store;
    this.rootURI = rootURI;
  }

  platform() {
    const { Services } = this.environment;
    const os = Services.appinfo.OS;
    const abi = Services.appinfo.XPCOMABI;
    const arch = /aarch64|arm64/iu.test(abi)
      ? 'aarch64'
      : /x86_64|amd64|x64/iu.test(abi)
        ? 'x86_64'
        : null;
    const asset = codexAssets[`${os}-${arch}`];
    if (!asset) throw new ReadingError('platform');
    return { os, arch, asset };
  }

  managedPath() {
    const { PathUtils } = this.environment;
    return PathUtils.join(
      this.store.directory,
      'codex',
      codexVersion,
      this.platform().asset.member,
    );
  }

  async discover(provider) {
    const { Services, PathUtils, IOUtils, ChromeUtils } = this.environment;
    if (provider.path) {
      if (await IOUtils.exists(provider.path)) return provider.path;
      throw new ReadingError('executable');
    }
    const { os, arch, asset } = this.platform();
    const home = Services.dirsvc.get('Home', this.environment.Components.interfaces.nsIFile).path;
    const candidates = [];
    const { Subprocess } = ChromeUtils.importESModule('resource://gre/modules/Subprocess.sys.mjs');
    try {
      candidates.push(await Subprocess.pathSearch(os === 'WINNT' ? 'codex.exe' : 'codex'));
    } catch {
      /* GUI processes may have a smaller PATH than a terminal. */
    }
    if (os === 'Darwin')
      candidates.push(
        '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex',
        PathUtils.join(
          home,
          'Applications',
          'ChatGPT.app',
          'Contents',
          'Resources',
          'codex-cli',
          'CodexCLI.app',
          'Contents',
          'MacOS',
          'codex',
        ),
        '/opt/homebrew/bin/codex',
        '/usr/local/bin/codex',
      );
    if (os !== 'WINNT')
      candidates.push(
        PathUtils.join(home, '.local', 'bin', 'codex'),
        PathUtils.join(home, '.npm-global', 'bin', 'codex'),
        PathUtils.join(home, '.volta', 'bin', 'codex'),
        '/usr/local/bin/codex',
        '/usr/bin/codex',
        '/snap/bin/codex',
      );
    else {
      candidates.push(PathUtils.join(home, '.local', 'bin', 'codex.exe'));
      const local = Services.env.get('LOCALAPPDATA');
      if (local)
        candidates.push(PathUtils.join(local, 'Programs', 'OpenAI', 'Codex', 'bin', 'codex.exe'));
      const roots = [Services.env.get('APPDATA'), Services.env.get('ProgramFiles')].filter(Boolean);
      const packageName = `codex-win32-${arch === 'aarch64' ? 'arm64' : 'x64'}`;
      const npmRoots = roots.map((root) =>
        PathUtils.join(
          root,
          root === Services.env.get('APPDATA') ? 'npm' : 'nodejs',
          'node_modules',
          '@openai',
        ),
      );
      for (const directory of Services.env.get('PATH').split(';').filter(Boolean))
        npmRoots.push(PathUtils.join(directory, 'node_modules', '@openai'));
      for (const npm of new Set(npmRoots)) {
        for (const vendor of [
          PathUtils.join(npm, packageName, 'vendor'),
          PathUtils.join(npm, 'codex', 'node_modules', '@openai', packageName, 'vendor'),
          PathUtils.join(npm, 'codex', 'vendor'),
        ]) {
          candidates.push(
            PathUtils.join(vendor, asset.triple, 'bin', 'codex.exe'),
            PathUtils.join(vendor, asset.triple, 'codex', 'codex.exe'),
          );
        }
      }
    }
    candidates.push(this.managedPath());
    for (const path of candidates) if (await IOUtils.exists(path)) return path;
    throw new ReadingError('executable');
  }

  async processEnvironment(path) {
    const { PathUtils, IOUtils, Zotero } = this.environment;
    const values = {};
    if (path === this.managedPath()) {
      values.CODEX_HOME = PathUtils.join(this.store.directory, 'codex-home');
      await IOUtils.makeDirectory(values.CODEX_HOME, { permissions: 0o700, ignoreExisting: true });
    }
    const proxy = Zotero.Prefs.get('extensions.readingCompanion.codexProxy', true);
    if (proxy) {
      const url = new URL(proxy);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
        throw new ReadingError('proxy');
      values.HTTPS_PROXY = proxy;
      values.HTTP_PROXY = proxy;
      values.NO_PROXY = 'localhost,127.0.0.1,::1';
    }
    return values;
  }

  async install(window, onProgress, signal) {
    if (this.installing) return this.installing;
    const { asset } = this.platform();
    const prompt = this.environment.Services.prompt;
    const choice = prompt.confirmEx(
      window,
      '准备 Codex',
      `首次使用需要下载一个约 ${Math.ceil(asset.size / 1048576)} MB 的官方组件` +
        '（来自 OpenAI 的 GitHub 发布页），用于登录和调用模型。',
      prompt.BUTTON_POS_0 * prompt.BUTTON_TITLE_IS_STRING +
        prompt.BUTTON_POS_1 * prompt.BUTTON_TITLE_CANCEL,
      '下载并继续',
      null,
      null,
      null,
      {},
    );
    if (choice !== 0) throw new ReadingError('cancelled');
    this.installing = this.download(asset, onProgress, signal);
    try {
      return await this.installing;
    } finally {
      this.installing = null;
    }
  }

  async download(asset, onProgress, signal) {
    const { IOUtils, PathUtils, ChromeUtils, Components } = this.environment;
    const destination = PathUtils.parent(this.managedPath());
    const directory = PathUtils.join(destination, 'staging');
    await IOUtils.makeDirectory(directory, { permissions: 0o700, ignoreExisting: true });
    const staged = PathUtils.join(directory, asset.member);
    const archive = PathUtils.join(directory, asset.name);
    const { Downloads } = ChromeUtils.importESModule('resource://gre/modules/Downloads.sys.mjs');
    const download = await Downloads.createDownload({ source: asset.url, target: archive });
    download.onchange = () => onProgress(`正在下载 Codex… ${download.progress}%`);
    const abort = () => download.cancel();
    signal.addEventListener('abort', abort, { once: true });
    try {
      signal.throwIfAborted();
      await download.start();
      signal.throwIfAborted();
      onProgress('正在校验官方发布物…');
      const bytes = await IOUtils.read(archive);
      const hash = Components.classes['@mozilla.org/security/hash;1'].createInstance(
        Components.interfaces.nsICryptoHash,
      );
      hash.init(hash.SHA256);
      hash.update(bytes, bytes.length);
      const digest = Array.from(hash.finish(false), (character) =>
        character.charCodeAt(0).toString(16).padStart(2, '0'),
      ).join('');
      if (digest !== asset.sha256) throw new ReadingError('download-hash');
      onProgress('正在准备 Codex…');
      if (this.platform().os === 'WINNT') {
        const file = Components.classes['@mozilla.org/file/local;1'].createInstance(
          Components.interfaces.nsIFile,
        );
        file.initWithPath(archive);
        const target = file.clone();
        target.initWithPath(staged);
        const zip = Components.classes['@mozilla.org/libjar/zip-reader;1'].createInstance(
          Components.interfaces.nsIZipReader,
        );
        zip.open(file);
        try {
          zip.extract(asset.member, target);
        } finally {
          zip.close();
        }
      } else {
        const { Subprocess } = ChromeUtils.importESModule(
          'resource://gre/modules/Subprocess.sys.mjs',
        );
        const process = await Subprocess.call({
          command: '/usr/bin/tar',
          arguments: ['-xzf', archive, '-C', directory, asset.member],
          stderr: 'stdout',
        });
        await process.stdout.readString();
        const result = await process.wait();
        if (result.exitCode) throw new ReadingError('download');
        await IOUtils.setPermissions(staged, 0o700);
      }
      signal.throwIfAborted();
      await IOUtils.writeUTF8(
        PathUtils.join(destination, 'LICENSE'),
        this.environment.Zotero.File.getContentsFromURL(this.rootURI + 'codex-LICENSE.txt'),
      );
      await IOUtils.move(staged, this.managedPath());
      return this.managedPath();
    } catch (error) {
      if (signal.aborted) throw new ReadingError('cancelled');
      if (error instanceof ReadingError) throw error;
      throw new ReadingError('download');
    } finally {
      signal.removeEventListener('abort', abort);
      await download.finalize(true);
      await IOUtils.remove(directory, { recursive: true, ignoreAbsent: true });
    }
  }
}
