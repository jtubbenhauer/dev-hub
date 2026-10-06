import type * as Monaco from "monaco-editor";

const trackerKey = Symbol.for("devhub.lsp.builtinTsTracker");
type TrackedRegistration = {
  actualDisposable: Monaco.IDisposable | null;
  isDisposedByOwner: boolean;
  restore(): void;
};
type Tracker = {
  readonly registrations: Set<TrackedRegistration>;
  baseline: {
    readonly ts: Monaco.typescript.DiagnosticsOptions;
    readonly js: Monaco.typescript.DiagnosticsOptions;
  } | null;
  markerGuard: Monaco.IDisposable | null;
};

function getTracker(monaco: typeof Monaco): Tracker {
  // The shared Monaco namespace carries our symbol across module reloads.
  const languages = monaco.languages as typeof Monaco.languages & {
    [trackerKey]?: Tracker;
  };
  const existing = languages[trackerKey];
  if (existing) return existing;
  const tracker: Tracker = {
    registrations: new Set(),
    baseline: null,
    markerGuard: null,
  };
  languages[trackerKey] = tracker;
  function wrap<Provider>(
    registerOriginal: (
      selector: Monaco.languages.LanguageSelector,
      provider: Provider,
    ) => Monaco.IDisposable,
  ) {
    return (
      selector: Monaco.languages.LanguageSelector,
      provider: Provider,
    ): Monaco.IDisposable => {
      if (selector !== "typescript" && selector !== "javascript") {
        return registerOriginal.call(languages, selector, provider);
      }
      const record = {
        registerOriginal,
        selector,
        provider,
        actualDisposable: tracker.baseline
          ? null
          : registerOriginal.call(languages, selector, provider),
        isDisposedByOwner: false,
        restore() {
          if (!record.isDisposedByOwner && record.actualDisposable === null) {
            record.actualDisposable = record.registerOriginal.call(
              languages,
              record.selector,
              record.provider,
            );
          }
        },
      };
      tracker.registrations.add(record);
      return {
        dispose() {
          if (record.isDisposedByOwner) return;
          record.isDisposedByOwner = true;
          tracker.registrations.delete(record);
          record.actualDisposable?.dispose();
          record.actualDisposable = null;
        },
      };
    };
  }
  languages.registerCompletionItemProvider = wrap(
    languages.registerCompletionItemProvider,
  );
  languages.registerHoverProvider = wrap(languages.registerHoverProvider);
  languages.registerSignatureHelpProvider = wrap(
    languages.registerSignatureHelpProvider,
  );
  languages.registerDefinitionProvider = wrap(
    languages.registerDefinitionProvider,
  );
  languages.registerDocumentRangeFormattingEditProvider = wrap(
    languages.registerDocumentRangeFormattingEditProvider,
  );
  languages.registerOnTypeFormattingEditProvider = wrap(
    languages.registerOnTypeFormattingEditProvider,
  );
  languages.registerInlayHintsProvider = wrap(
    languages.registerInlayHintsProvider,
  );
  return tracker;
}

export function trackBuiltinTs(monaco: typeof Monaco): void {
  getTracker(monaco);
}

export function suppressBuiltinTypeScriptFeatures(monaco: typeof Monaco): void {
  const tracker = getTracker(monaco);
  if (tracker.baseline) return;
  const { typescriptDefaults, javascriptDefaults } = monaco.typescript;
  tracker.baseline = {
    ts: typescriptDefaults.getDiagnosticsOptions(),
    js: javascriptDefaults.getDiagnosticsOptions(),
  };
  for (const record of tracker.registrations) {
    record.actualDisposable?.dispose();
    record.actualDisposable = null;
  }
  let isClearing = false;
  const clearBuiltinMarkers = () => {
    if (!tracker.baseline || isClearing) return;
    isClearing = true;
    try {
      for (const owner of ["typescript", "javascript"]) {
        if (monaco.editor.getModelMarkers({ owner }).length > 0) {
          monaco.editor.removeAllMarkers(owner);
        }
      }
    } finally {
      isClearing = false;
    }
  };
  tracker.markerGuard = monaco.editor.onDidChangeMarkers(clearBuiltinMarkers);
  for (const defaults of [typescriptDefaults, javascriptDefaults]) {
    defaults.setDiagnosticsOptions({
      ...defaults.getDiagnosticsOptions(),
      noSemanticValidation: true,
      noSyntaxValidation: true,
      noSuggestionDiagnostics: true,
    });
  }
  clearBuiltinMarkers();
}

export function restoreBuiltinTypeScriptFeatures(monaco: typeof Monaco): void {
  const tracker = getTracker(monaco);
  const baseline = tracker.baseline;
  if (!baseline) return;
  tracker.baseline = null;
  tracker.markerGuard?.dispose();
  tracker.markerGuard = null;
  for (const record of tracker.registrations) record.restore();
  monaco.typescript.typescriptDefaults.setDiagnosticsOptions(baseline.ts);
  monaco.typescript.javascriptDefaults.setDiagnosticsOptions(baseline.js);
}
