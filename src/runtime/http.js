export class LocalEndpoints {
  constructor(application) {
    this.application = application;
    this.paths = [];
  }

  async initialize() {
    const application = this.application;
    const { Zotero } = application.environment;
    if (!(await application.secrets.get('browser-pairing'))) {
      await application.secrets.set(
        'browser-pairing',
        application.identifier() + application.identifier(),
      );
    }
    this.register('pair', async () => ({ paired: true }));
    this.register('ping', async () => ({ version: '0.2.0', port: Zotero.Server.port }));
    this.register('save', async (data) => {
      const configuration = application.store.configuration();
      return application.imports.submit(data, {
        libraryID: configuration.libraryID || Zotero.Libraries.userLibraryID,
        collectionID: configuration.collectionID,
      });
    });
    this.register('status', async (data) => application.imports.status(data.id));
    this.register('attach', async (data) => application.imports.supplement(data));
    this.register('open', async (data) => {
      const job = application.imports.status(data.id);
      if (!job.itemID) throw new Error('条目尚未保存，请等待完成。');
      await application.imports.repository.open(job.itemID);
      return { opened: true };
    });
  }

  register(name, handler) {
    const path = `/reading-companion/${name}`;
    const application = this.application;
    const endpoint = function () {};
    endpoint.prototype = {
      supportedMethods: ['POST'],
      supportedDataTypes: ['application/json'],
      async init(request) {
        const zotero = application.environment.Zotero;
        const origin = request.headers.origin || '';
        const client = request.headers['x-reading-companion-client'] || '';
        const trustedOrigin =
          /^(chrome|moz)-extension:\/\/[\w-]+$/u.test(client) && (!origin || origin === client);
        const preference = 'extensions.readingCompanion.browserClients';
        let clients;
        try {
          clients = JSON.parse(zotero.Prefs.get(preference, true) || '[]');
        } catch {
          clients = [];
        }
        let authorized = trustedOrigin && clients.includes(client);
        if (name === 'pair' && trustedOrigin) {
          const expected = await application.secrets.get('browser-pairing');
          authorized = Boolean(
            expected && request.headers['x-reading-companion-token'] === expected,
          );
          if (authorized && !clients.includes(client)) {
            zotero.Prefs.set(preference, JSON.stringify([...clients, client]), true);
          }
        }
        if (!authorized) {
          return [
            403,
            'application/json',
            JSON.stringify({ error: '配对失败，请重新配置配对码。' }),
          ];
        }
        try {
          const result = await handler(request.data || {});
          return [200, 'application/json', JSON.stringify(result)];
        } catch {
          return [
            400,
            'application/json',
            JSON.stringify({
              error: '保存操作未完成，请检查页面、目标文库及 PDF 访问权限后重试。',
            }),
          ];
        }
      },
    };
    application.environment.Zotero.Server.Endpoints[path] = endpoint;
    this.paths.push(path);
  }

  close() {
    for (const path of this.paths)
      delete this.application.environment.Zotero.Server.Endpoints[path];
    this.paths = [];
  }
}
