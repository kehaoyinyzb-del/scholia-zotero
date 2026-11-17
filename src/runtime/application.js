import { ReadingNotes } from './reading-notes.js';
import { SelectionPopup } from './selection-popup.js';
import { TranslationService } from './translations.js';
import { AnnotationService } from './annotations.js';
import { ConnectionSetup } from './setup.js';
import { diagnosticText } from '../domain/service-error.js';
import { SummaryService } from './summary.js';
import { NotebookService } from './notebook.js';
import { LocalStore } from './storage.js';
import { SecretStore } from './secrets.js';
import { ReaderAdapter } from './reader.js';
import { ModelService } from './models.js';
import { ReadingSession } from '../application/reading-session.js';
import { ImportQueue } from '../application/import-queue.js';
import { ImportRepository } from './import-repository.js';
import { LocalEndpoints } from './http.js';
import { ReaderWorkspace } from './workspace.js';
import { action } from '../ui/dom.js';
import { mountSettings } from '../ui/settings.js';
import { saveChildNote, pdfURI } from './notes.js';
import { captureFailure } from '../domain/diagnostics.js';

export function createApplication(environment, rootURI, pluginID) {
  const { Zotero, Services, IOUtils, PathUtils, Components } = environment;
  const application = {
    environment,
    rootURI,
    pluginID,
    version: environment.version || 'unknown',
    panels: new Map(),
    workspaces: new Map(),
    windowResources: new Map(),
    diagnostics: [],
    identifier: () => Services.uuid.generateUUID().toString().slice(1, -1),
  };
  application.recordFailure = (error, where) => {
    application.diagnostics.push(captureFailure(error, where));
    application.diagnostics = application.diagnostics.slice(-100);
  };
  application.openReaderWorkspace = (window) => {
    let workspace = application.workspaces.get(window);
    if (!workspace) {
      workspace = new ReaderWorkspace(window, application);
      application.workspaces.set(window, workspace);
    } else workspace.show();
    return workspace;
  };
  application.store = new LocalStore(Zotero, IOUtils, PathUtils);
  application.secrets = new SecretStore(Services, Components);
  application.reader = new ReaderAdapter(Zotero, application.identifier, Components);
  application.models = new ModelService(
    environment,
    application.store,
    application.secrets,
    rootURI,
  );
  application.setup = new ConnectionSetup(application);
  application.selection = new SelectionPopup(application);
  application.translations = new TranslationService(application);
  application.store.onGlossaryChange = (session) => application.translations.invalidate(session);
  application.annotations = new AnnotationService(application);
  application.readingNotes = new ReadingNotes(application);
  application.notebooks = new NotebookService(application);
  application.sessions = new ReadingSession({
    reader: application.reader,
    store: application.store,
    models: application.models,
    identifier: application.identifier,
    createAbortController: () => new (Zotero.getMainWindow().AbortController)(),
  });
  application.summaries = new SummaryService(application);
  application.sessions.summarize = (options) => application.summaries.run(options);
  application.imports = new ImportQueue(
    new ImportRepository(environment, application.store),
    application.store,
  );
  application.endpoints = new LocalEndpoints(application);

  application.windowLoaded = (window) => {
    if (application.windowResources.has(window)) return;
    const document = window.document;
    const style = document.createElement('link');
    style.setAttribute('rel', 'stylesheet');
    style.setAttribute('href', rootURI + 'reading-companion.css');
    const localization = document.createElement('link');
    localization.setAttribute('rel', 'localization');
    localization.setAttribute('href', 'reading-companion.ftl');
    document.documentElement.append(style, localization);
    application.windowResources.set(window, [style, localization]);
  };

  application.start = async () => {
    application.popupCSS = Zotero.File.getContentsFromURL(rootURI + 'reading-companion.css');
    application.translations.initialize();
    await application.store.initialize();
    await application.imports.initialize();
    await application.endpoints.initialize();
    application.annotations.start();
    for (const window of Zotero.getMainWindows()) application.windowLoaded(window);
    application.section = Zotero.ItemPaneManager.registerSection({
      paneID: 'reading-companion',
      pluginID,
      header: { l10nID: 'reading-companion-title', icon: rootURI + 'icon.svg' },
      sidenav: { l10nID: 'reading-companion-title', icon: rootURI + 'icon.svg' },
      onRender: ({ doc, body, tabType, setEnabled }) => {
        try {
          setEnabled(tabType === 'reader');
          if (!body.querySelector('[data-rc-open-workspace]')) {
            application.windowLoaded(doc.defaultView);
            body.append(
              action(
                doc,
                '打开阅读面板',
                () => {
                  application.openReaderWorkspace(doc.defaultView);
                },
                { 'data-rc-open-workspace': '', class: 'rc-workspace-entry' },
              ),
            );
          }
        } catch (error) {
          application.recordFailure(error, `section-render:${tabType}`);
          throw error;
        }
      },
      onItemChange: ({ tabType, setEnabled }) => {
        setEnabled(tabType === 'reader');
        return true;
      },
    });
    application.summaryMenu = Zotero.MenuManager.registerMenu({
      menuID: 'reading-companion-summary',
      pluginID,
      target: 'main/library/item',
      menus: [
        {
          menuType: 'menuitem',
          l10nID: 'reading-companion-summary',
          onShowing: (_event, context) => context.setEnabled(context.items?.length === 1),
          onCommand: (_event, context) =>
            application.summaries
              .fromLibrary(context.items[0], Zotero.getMainWindow())
              .catch((error) => Zotero.alert(Zotero.getMainWindow(), '总结全文', error.message)),
        },
      ],
    });
    await Zotero.PreferencePanes.register({
      id: 'reading-companion-settings-pane',
      pluginID,
      label: 'Scholia',
      src: rootURI + 'preferences.xhtml',
      scripts: [rootURI + 'preferences.js'],
      stylesheets: [rootURI + 'reading-companion.css'],
    });
    application.selectionHandler = (event) => {
      application.selection.render(event).catch((error) => {
        application.recordFailure(error, 'selection-popup');
      });
    };
    Zotero.Reader.registerEventListener(
      'renderTextSelectionPopup',
      application.selectionHandler,
      pluginID,
    );
    application.toolbarHandler = ({ doc, append }) => {
      application.selection.start();
      application.selection.pollReaders();
      application.models.prewarmSelection().catch((error) => {
        application.recordFailure(error, 'selection-prewarm');
      });
      append(
        action(
          doc,
          'Scholia',
          () => {
            application.openReaderWorkspace(Zotero.getMainWindow());
          },
          { 'data-rc-open-workspace': '', title: '打开 Scholia：提问、翻译或引用原文' },
        ),
      );
    };
    Zotero.Reader.registerEventListener('renderToolbar', application.toolbarHandler, pluginID);
  };

  application.stop = async () => {
    Zotero.MenuManager.unregisterMenu(application.summaryMenu);
    application.endpoints.close();
    const readingStopped = application.sessions.close();
    const setupStopped = application.setup.close();
    const translationsStopped = application.translations.close();
    application.selection.close();
    application.annotations.close();
    await application.models.close();
    await setupStopped;
    await translationsStopped;
    await application.notebooks.close();
    Zotero.Reader.unregisterEventListener('renderTextSelectionPopup', application.selectionHandler);
    Zotero.Reader.unregisterEventListener('renderToolbar', application.toolbarHandler);
    for (const workspace of application.workspaces.values()) workspace.destroy();
    application.workspaces.clear();
    for (const panel of application.panels.values()) panel.destroy();
    application.panels.clear();
    if (application.section) Zotero.ItemPaneManager.unregisterSection(application.section);
    Zotero.PreferencePanes.unregister('reading-companion-settings-pane');
    for (const resources of application.windowResources.values()) {
      for (const resource of resources) resource.remove();
    }
    application.windowResources.clear();
    application.reader.clear();
    await readingStopped;
    await application.imports.close();
    await application.store.close();
  };

  application.copyDiagnostics = (error, provider) => {
    Zotero.Utilities.Internal.copyTextToClipboard(
      diagnosticText({
        version: application.version,
        zoteroVersion: Zotero.version,
        system: Services.appinfo.OS,
        provider,
        error,
      }),
    );
  };
  application.openConnection = (onComplete) => {
    application.openReaderWorkspace(Zotero.getMainWindow()).panel.onboarding.show(onComplete);
  };
  application.openSettings = () => {
    Zotero.Utilities.Internal.openPreferences('reading-companion-settings-pane');
  };
  application.mountSettings = (document) => mountSettings(document, application);
  application.saveNote = (turn) => saveChildNote(Zotero, turn);
  application.copy = (turn) => {
    const links = turn.snapshot.sources.map((source) => {
      return pdfURI(Zotero, turn.snapshot, source.pageIndex);
    });
    const translations =
      turn.answer.translation?.rows.map((row) => {
        return `${row.original}\n${row.translation}`;
      }) || [];
    Zotero.Utilities.Internal.copyTextToClipboard(
      [turn.answer.text, ...translations, ...links].join('\n\n'),
    );
  };
  return application;
}
