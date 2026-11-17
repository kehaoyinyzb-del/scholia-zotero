var application;

function install() {}
function uninstall() {}

async function startup({ id, rootURI, version }) {
  await Zotero.initializationPromise;
  const scope = { setTimeout, clearTimeout, setInterval, clearInterval, TextDecoder, URL };
  Services.scriptloader.loadSubScript(rootURI + 'reading-companion.js', scope, 'UTF-8');
  const environment = {
    version,
    Zotero,
    Services,
    IOUtils,
    PathUtils,
    Components,
    ChromeUtils,
    DOMParser,
    atob,
  };
  application = scope.ReadingCompanion.createApplication(environment, rootURI, id);
  Zotero['reading-companion@local'] = application;
  try {
    await application.start();
  } catch (error) {
    await shutdown();
    throw error;
  }
}

async function shutdown() {
  if (application) await application.stop();
  delete Zotero['reading-companion@local'];
  application = null;
}

function onMainWindowLoad({ window }) {
  application?.windowLoaded(window);
}

function onMainWindowUnload({ window }) {
  application?.workspaces.get(window)?.destroy();
  application?.workspaces.delete(window);
  const resources = application?.windowResources.get(window) || [];
  for (const resource of resources) resource.remove();
  application?.windowResources.delete(window);
}
