import { vi } from "vitest";
import type { MonacoLanguageClientOptions } from "monaco-languageclient";
import type { LspWorkspaceEditResult } from "@/lib/lsp/types";

const mocks = vi.hoisted(() => ({
  construct: vi.fn<(options: MonacoLanguageClientOptions) => void>(),
  start: vi.fn<() => Promise<void>>(),
  dispose: vi.fn<() => Promise<void>>(),
  onNotification:
    vi.fn<
      (
        method: string,
        handler: (result: LspWorkspaceEditResult) => void,
      ) => { dispose(): void }
    >(),
  sendNotification: vi.fn(),
  editDispose: vi.fn(),
  dirtyDispose: vi.fn(),
  dirtySync:
    vi.fn<
      typeof import("@/lib/lsp/client/dirty-documents-sync").startDirtyDocumentsSync
    >(),
  editResult: vi.fn(),
  bootstrap: vi.fn(),
  suppress: vi.fn(),
  toSocket: vi.fn(),
  reader: vi.fn(),
  writer: vi.fn(),
  overlayDispose: vi.fn(),
  registerOverlay: vi.fn(),
  createFileSystem: vi.fn(),
  registerOpenGuard: vi.fn(),
  openGuardDispose: vi.fn(),
  registerCommands: vi.fn(),
  commandsDispose: vi.fn(),
  asUri: vi.fn(),
  asPosition: vi.fn(),
  asLocation: vi.fn(),
}));

vi.mock("monaco-languageclient", () => ({
  MonacoLanguageClient: class {
    constructor(options: MonacoLanguageClientOptions) {
      mocks.construct(options);
    }
    start = mocks.start;
    dispose = mocks.dispose;
    onNotification = mocks.onNotification;
    sendNotification = mocks.sendNotification;
    protocol2CodeConverter = {
      asUri: mocks.asUri,
      asPosition: mocks.asPosition,
      asLocation: mocks.asLocation,
    };
  },
}));
vi.mock("vscode-ws-jsonrpc", () => ({
  toSocket: mocks.toSocket,
  WebSocketMessageReader: class {
    constructor(socket: unknown) {
      mocks.reader(socket);
    }
  },
  WebSocketMessageWriter: class {
    constructor(socket: unknown) {
      mocks.writer(socket);
    }
  },
}));
vi.mock("vscode", () => ({
  Uri: { file: (path: string) => ({ path }) },
  Position: class {},
  Location: class {},
}));
vi.mock("vscode-languageclient/browser.js", () => ({
  ErrorAction: { Shutdown: 2 },
  CloseAction: { DoNotRestart: 1 },
}));
vi.mock("@/lib/editor/monaco-bootstrap", () => ({
  ensureMonacoBootstrapped: mocks.bootstrap,
  loadLspClientRuntime: () => import("@/lib/lsp/client/lsp-client-runtime"),
}));
vi.mock("@/lib/lsp/client/builtin-typescript", () => ({
  suppressBuiltinTypeScriptFeatures: mocks.suppress,
}));
vi.mock("@/lib/lsp/client/dirty-documents-sync", () => ({
  startDirtyDocumentsSync: mocks.dirtySync,
}));
vi.mock("@/lib/lsp/client/workspace-edit-sync", () => ({
  handleWorkspaceEditResult: mocks.editResult,
}));
vi.mock("@codingame/monaco-vscode-files-service-override", () => ({
  registerFileSystemOverlay: mocks.registerOverlay,
}));
vi.mock("@/lib/lsp/client/workspace-file-system", () => ({
  createWorkspaceFileSystemProvider: mocks.createFileSystem,
}));
vi.mock("@/lib/lsp/client/open-editor", () => ({
  registerLspOpenGuard: mocks.registerOpenGuard,
}));
vi.mock("@/lib/lsp/client/lsp-commands", () => ({
  registerLspClientCommands: mocks.registerCommands,
}));

export { mocks };
