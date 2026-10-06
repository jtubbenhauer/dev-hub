import type * as Monaco from "monaco-editor";
import { vi } from "vitest";
import type { LspBrowserTransport } from "@/lib/lsp/client/browser-transport";

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

export function fakeSource(
  surface: string | null,
  model: Monaco.editor.ITextModel | null = null,
) {
  const container = document.createElement("div");
  const child = document.createElement("div");
  if (surface !== null) container.setAttribute("data-lsp-surface", surface);
  container.append(child);
  return {
    getModel: () => model,
    getContainerDomNode: () => child,
  } as unknown as Monaco.editor.ICodeEditor;
}

export function createSessionFixture() {
  const order: string[] = [];
  const features = {
    dispose: vi.fn(() => {
      order.push("client");
    }),
  };
  const construct = vi.fn();
  class FakeMonacoLspClient {
    constructor(transport: unknown) {
      construct(transport);
      this.createFeatures();
    }
    protected createFeatures() {
      return features;
    }
  }
  const defaults = (modeConfiguration: Monaco.typescript.ModeConfiguration) => {
    let diagnostics: Monaco.typescript.DiagnosticsOptions = {
      noSemanticValidation: modeConfiguration.hovers,
      noSyntaxValidation: false,
      diagnosticCodesToIgnore: [1234],
    };
    return {
      modeConfiguration,
      getDiagnosticsOptions: vi.fn(() => diagnostics),
      setDiagnosticsOptions: vi.fn(
        (next: Monaco.typescript.DiagnosticsOptions) => {
          diagnostics = next;
        },
      ),
      setModeConfiguration: vi.fn(function (
        this: { modeConfiguration: Monaco.typescript.ModeConfiguration },
        next: Monaco.typescript.ModeConfiguration,
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
  const models: Monaco.editor.ITextModel[] = [];
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
  const editors: Monaco.editor.ICodeEditor[] = [];
  const openerDisposable = {
    dispose: vi.fn(() => {
      order.push("opener");
    }),
  };
  const mirrorDisposable = {
    dispose: vi.fn(() => {
      order.push("mirror");
    }),
  };
  const editor = {
    getModels: vi.fn(() => models),
    getEditors: vi.fn(() => editors),
    createModel: vi.fn(
      (
        _content: string,
        _language: string | undefined,
        uri: Monaco.Uri | undefined,
      ) => {
        const model = fakeModel(uri?.toString() ?? "inmemory://model/1");
        models.push(model);
        return model;
      },
    ),
    registerEditorOpener: vi.fn(
      (_opener: Monaco.editor.ICodeEditorOpener) => openerDisposable,
    ),
    onDidChangeMarkers: vi.fn(
      (_listener: (uris: readonly Monaco.Uri[]) => void) => mirrorDisposable,
    ),
    getModelMarkers: vi.fn<typeof Monaco.editor.getModelMarkers>(() => []),
    removeAllMarkers: vi.fn((_owner: string) => {
      order.push("markers");
    }),
  };
  const Uri = { parse: vi.fn(fakeUri) };
  const transport = {
    state: {
      value: { state: "open" },
      onChange: vi.fn(() => ({ dispose: vi.fn() })),
    },
    send: vi.fn(async () => {}),
    setListener: vi.fn(),
    toString: () => "fake",
    detach: vi.fn(() => {
      order.push("transport");
    }),
    getTrackedDocumentMapSizes: () => ({ documentUris: 0, sentByPath: 0 }),
  } satisfies LspBrowserTransport;
  // The fake deliberately implements only the APIs this adapter consumes.
  const monaco = {
    lsp: { MonacoLspClient: FakeMonacoLspClient },
    typescript,
    languages,
    editor,
    Uri,
  } as unknown as typeof Monaco;
  return {
    monaco,
    languages,
    registrations,
    typescript,
    editor,
    Uri,
    transport,
    models,
    editors,
    order,
    features,
    construct,
    openerDisposable,
    mirrorDisposable,
  };
}

export const sessionOptions = {
  wsUrl: "ws://localhost:7601",
  workspaceId: "workspace & 1",
  workspaceRoot: "/Workspace",
  onUnexpectedClose: vi.fn(),
};
