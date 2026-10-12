import type * as Monaco from "monaco-editor";

const trackerKey = Symbol.for("devhub.lsp.builtinTsTracker");
type TrackedRegistration = {
  actualDisposable: Monaco.IDisposable | null;
  isDisposedByOwner: boolean;
  restore(): void;
};
type Tracker = {
  readonly registrations: Set<TrackedRegistration>;
  isSuppressed: boolean;
  stopWorkers: (() => void) | null;
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
    isSuppressed: false,
    stopWorkers: null,
  };
  languages[trackerKey] = tracker;
  function wrap<Provider, ExtraArguments extends unknown[]>(
    registerOriginal: (
      selector: Monaco.languages.LanguageSelector,
      provider: Provider,
      ...extraArguments: ExtraArguments
    ) => Monaco.IDisposable,
  ) {
    return (
      selector: Monaco.languages.LanguageSelector,
      provider: Provider,
      ...extraArguments: ExtraArguments
    ): Monaco.IDisposable => {
      if (selector !== "typescript" && selector !== "javascript") {
        return registerOriginal.call(
          languages,
          selector,
          provider,
          ...extraArguments,
        );
      }
      const record = {
        registerOriginal,
        selector,
        provider,
        actualDisposable: tracker.isSuppressed
          ? null
          : registerOriginal.call(
              languages,
              selector,
              provider,
              ...extraArguments,
            ),
        isDisposedByOwner: false,
        restore() {
          if (!record.isDisposedByOwner && record.actualDisposable === null) {
            record.actualDisposable = record.registerOriginal.call(
              languages,
              record.selector,
              record.provider,
              ...extraArguments,
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
  languages.registerReferenceProvider = wrap(
    languages.registerReferenceProvider,
  );
  languages.registerDocumentHighlightProvider = wrap(
    languages.registerDocumentHighlightProvider,
  );
  languages.registerDocumentSymbolProvider = wrap(
    languages.registerDocumentSymbolProvider,
  );
  languages.registerRenameProvider = wrap(languages.registerRenameProvider);
  languages.registerCodeActionProvider = wrap(
    languages.registerCodeActionProvider,
  );
  return tracker;
}

export function trackBuiltinTs(
  monaco: typeof Monaco,
  stopWorkers?: () => void,
): void {
  const tracker = getTracker(monaco);
  if (stopWorkers) tracker.stopWorkers = stopWorkers;
}

export function suppressBuiltinTypeScriptFeatures(monaco: typeof Monaco): void {
  const tracker = getTracker(monaco);
  if (tracker.isSuppressed) return;
  tracker.isSuppressed = true;
  for (const record of tracker.registrations) {
    record.actualDisposable?.dispose();
    record.actualDisposable = null;
  }
  tracker.stopWorkers?.();
}

export function restoreBuiltinTypeScriptFeatures(monaco: typeof Monaco): void {
  const tracker = getTracker(monaco);
  if (!tracker.isSuppressed) return;
  tracker.isSuppressed = false;
  for (const record of tracker.registrations) record.restore();
}
