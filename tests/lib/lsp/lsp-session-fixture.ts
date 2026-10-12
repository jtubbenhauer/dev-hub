import type * as Monaco from "monaco-editor";
import { vi } from "vitest";
import type {
  DiagnosticsOptions,
  ModeConfiguration,
} from "@codingame/monaco-vscode-standalone-typescript-language-features";

export class FakeSessionWebSocket extends EventTarget {
  static instances: FakeSessionWebSocket[] = [];
  static isAutoOpen = true;
  readonly close = vi.fn((code = 1000) => {
    this.dispatchEvent(new CloseEvent("close", { code }));
  });

  constructor(readonly url: string) {
    super();
    FakeSessionWebSocket.instances.push(this);
    if (FakeSessionWebSocket.isAutoOpen) queueMicrotask(() => this.open());
  }

  open() {
    this.dispatchEvent(new Event("open"));
  }
}

export function fakeUri(encoded: string) {
  // Only URI stringification is exercised; never load Monaco's runtime in jsdom.
  return {
    toString: vi.fn((skipEncoding?: boolean) =>
      skipEncoding ? decodeURI(encoded) : encoded,
    ),
  } as unknown as Monaco.Uri;
}

export function fakeModel(uri: string) {
  let isDisposed = false;
  return {
    uri: fakeUri(uri),
    isDisposed: vi.fn(() => isDisposed),
    isAttachedToEditor: vi.fn(() => false),
    dispose: vi.fn(() => {
      isDisposed = true;
    }),
  } as unknown as Monaco.editor.ITextModel;
}

export function createSessionFixture() {
  const defaults = (modeConfiguration: ModeConfiguration) => {
    let diagnostics: DiagnosticsOptions = {
      noSemanticValidation: modeConfiguration.hovers,
      noSyntaxValidation: false,
      diagnosticCodesToIgnore: [1234],
    };
    return {
      modeConfiguration,
      getDiagnosticsOptions: vi.fn(() => diagnostics),
      setDiagnosticsOptions: vi.fn((next: DiagnosticsOptions) => {
        diagnostics = next;
      }),
      setModeConfiguration: vi.fn(function (
        this: { modeConfiguration: ModeConfiguration },
        next: ModeConfiguration,
      ) {
        this.modeConfiguration = next;
      }),
    };
  };
  const typescript = {
    typescriptDefaults: defaults({
      completionItems: true,
      hovers: false,
      diagnostics: true,
      references: true,
      rename: false,
      documentHighlights: true,
      documentSymbols: false,
      codeActions: true,
    }),
    javascriptDefaults: defaults({
      completionItems: false,
      hovers: true,
      diagnostics: false,
      references: false,
      rename: true,
      documentHighlights: false,
      documentSymbols: true,
      codeActions: false,
    }),
  };
  const registrations = new Set<{
    readonly selector: Monaco.languages.LanguageSelector;
    readonly provider: unknown;
  }>();
  const register = (
    selector: Monaco.languages.LanguageSelector,
    provider: unknown,
  ) => {
    const entry = { selector, provider };
    registrations.add(entry);
    return {
      dispose: vi.fn(() => {
        registrations.delete(entry);
      }),
    };
  };
  const languages = {
    registerCompletionItemProvider: register,
    registerHoverProvider: register,
    registerSignatureHelpProvider: register,
    registerDefinitionProvider: register,
    registerDocumentRangeFormattingEditProvider: register,
    registerOnTypeFormattingEditProvider: register,
    registerInlayHintsProvider: register,
    registerReferenceProvider: register,
    registerRenameProvider: register,
    registerDocumentHighlightProvider: register,
    registerDocumentSymbolProvider: register,
    registerCodeActionProvider: register,
  };
  const mirrorDisposable = {
    dispose: vi.fn(),
  };
  const editor = {
    onDidChangeMarkers: vi.fn(
      (_listener: (uris: readonly Monaco.Uri[]) => void) => mirrorDisposable,
    ),
    getModelMarkers: vi.fn<typeof Monaco.editor.getModelMarkers>(() => []),
    removeAllMarkers: vi.fn<(_owner: string) => void>(),
  };
  // The fake deliberately implements only the APIs this adapter consumes.
  const monaco = {
    languages,
    editor,
  } as unknown as typeof Monaco;
  return {
    monaco,
    languages,
    registrations,
    typescript,
    editor,
    mirrorDisposable,
  };
}
