/* acceptanceConfig is written by the launcher into this disposable helper extension only. */
var acceptanceRunner;
function install() {}
function uninstall() {}
function shutdown() {}

async function startup({ rootURI }) {
  await Zotero.initializationPromise;
  if (Zotero.DataDirectory.dir !== acceptanceConfig.data) return;
  const scope = { setTimeout, clearTimeout, URL };
  Services.scriptloader.loadSubScript(rootURI + 'driver.js', scope, 'UTF-8');
  acceptanceRunner = scope.AcceptanceDriver.runAcceptance(
    {
      Zotero,
      Services,
      IOUtils,
      PathUtils,
      Components,
      ChromeUtils,
      atob,
    },
    acceptanceConfig,
  );
}
