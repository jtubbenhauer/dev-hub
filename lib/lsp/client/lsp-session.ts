import type * as Monaco from "monaco-editor";
import type { MonacoLanguageClient } from "monaco-languageclient";
import {
  ensureMonacoBootstrapped,
  loadLspClientRuntime,
} from "@/lib/editor/monaco-bootstrap";
import { suppressBuiltinTypeScriptFeatures } from "@/lib/lsp/client/builtin-typescript";
import { startDiagnosticsMirror } from "@/lib/lsp/client/diagnostics-mirror";
import { startDirtyDocumentsSync } from "@/lib/lsp/client/dirty-documents-sync";
import { buildLspMiddleware } from "@/lib/lsp/client/lsp-middleware";
import {
  getActiveLspSession,
  getRegisteredLspMonaco,
  registerLspSessionConnector,
  setActiveLspSession,
  setRegisteredLspMonaco,
} from "@/lib/lsp/client/lsp-session-registry";
import { waitForLspSocketOpen } from "@/lib/lsp/client/socket-open";
import { handleWorkspaceEditResult } from "@/lib/lsp/client/workspace-edit-sync";
import { ensureWorkspaceFileOverlay } from "@/lib/lsp/client/workspace-overlay-registry";
import {
  LSP_DIAGNOSTIC_MARKER_OWNER,
  LSP_DIRTY_DOCUMENTS_NOTIFICATION,
  LSP_EDIT_RESULT_NOTIFICATION,
  type LspWorkspaceEditResult,
} from "@/lib/lsp/types";
import { useDiagnosticsStore } from "@/stores/diagnostics-store";
import { useLspStore } from "@/stores/lsp-store";

export {
  getActiveLspWorkspaceRoot,
  getRegisteredLspMonaco,
} from "@/lib/lsp/client/lsp-session-registry";

export interface LspSessionHandle {
  readonly workspaceId: string;
  dispose(): Promise<void>;
}

export function registerLspMonacoInstance(monaco: typeof Monaco): void {
  if (getRegisteredLspMonaco() !== null) return;
  setRegisteredLspMonaco(monaco);
  // The global driver connects through the registry so it never imports this module.
  registerLspSessionConnector(connectLspSession);
  useLspStore.getState().markMonacoRegistered();
}

export async function connectLspSession({
  wsUrl,
  workspaceId,
  workspaceRoot,
  onUnexpectedClose,
}: {
  readonly wsUrl: string;
  readonly workspaceId: string;
  readonly workspaceRoot: string;
  readonly onUnexpectedClose: (code: number, reason: string) => void;
}): Promise<LspSessionHandle> {
  const monaco = getRegisteredLspMonaco() ?? (await ensureMonacoBootstrapped());
  registerLspMonacoInstance(monaco);
  suppressBuiltinTypeScriptFeatures(monaco);
  // This module is also imported during SSR; load browser APIs only after bootstrap.
  const {
    MonacoLanguageClient,
    ErrorAction,
    CloseAction,
    vscode,
    toSocket,
    WebSocketMessageReader,
    WebSocketMessageWriter,
    registerFileSystemOverlay,
    createWorkspaceFileSystemProvider,
    registerLspOpenGuard,
    registerLspClientCommands,
  } = await loadLspClientRuntime();
  const webSocket = new WebSocket(wsUrl);
  let isDisposed = false;
  let disposal: Promise<void> | undefined;
  let client: MonacoLanguageClient | undefined;
  let mirror: Monaco.IDisposable | undefined;
  let editSubscription: Monaco.IDisposable | undefined;
  let dirtySync: Monaco.IDisposable | undefined;
  let openGuard: Monaco.IDisposable | undefined;
  let commands: Monaco.IDisposable | undefined;
  const session = { workspaceRoot };
  const onClose = (event: CloseEvent) => {
    if (!isDisposed) onUnexpectedClose(event.code, event.reason);
  };
  webSocket.addEventListener("close", onClose, { once: true });

  async function cleanup(): Promise<void> {
    commands?.dispose();
    openGuard?.dispose();
    dirtySync?.dispose();
    editSubscription?.dispose();
    try {
      await client?.dispose();
    } catch (error) {
      // Session teardown is terminal: even a failed client shutdown must release the socket.
      console.debug("[lsp] dispose", error);
    } finally {
      webSocket.onmessage = null;
      webSocket.onerror = null;
      webSocket.onclose = null;
      webSocket.close(1000);
      monaco.editor.removeAllMarkers(LSP_DIAGNOSTIC_MARKER_OWNER);
      mirror?.dispose();
      useDiagnosticsStore
        .getState()
        .clearSourceForWorkspace(workspaceId, "typescript");
    }
  }
  function dispose(): Promise<void> {
    if (disposal) return disposal;
    isDisposed = true;
    if (getActiveLspSession() === session) setActiveLspSession(null);
    webSocket.removeEventListener("close", onClose);
    disposal = cleanup();
    return disposal;
  }

  try {
    await waitForLspSocketOpen(webSocket);
    // Client startup may resolve file models; priority 1 precedes the in-memory provider (0).
    ensureWorkspaceFileOverlay({ workspaceId, workspaceRoot }, () =>
      registerFileSystemOverlay(
        1,
        createWorkspaceFileSystemProvider({ workspaceId, workspaceRoot }),
      ),
    );
    const socket = toSocket(webSocket);
    client = new MonacoLanguageClient({
      name: "dev-hub-vtsls",
      clientOptions: {
        documentSelector: [
          {
            scheme: "file",
            language: "typescript",
            pattern: `${workspaceRoot}/**/*`,
          },
          {
            scheme: "file",
            language: "javascript",
            pattern: `${workspaceRoot}/**/*`,
          },
        ],
        workspaceFolder: {
          uri: vscode.Uri.file(workspaceRoot),
          name: workspaceRoot.replace(/\/+$/, "").split("/").pop() || "/",
          index: 0,
        },
        diagnosticCollectionName: LSP_DIAGNOSTIC_MARKER_OWNER,
        middleware: buildLspMiddleware({
          getClient: () => client,
          vscodeTypes: vscode,
        }),
        errorHandler: {
          error: () => ({ action: ErrorAction.Shutdown }),
          closed: () => ({ action: CloseAction.DoNotRestart }),
        },
      },
      messageTransports: {
        reader: new WebSocketMessageReader(socket),
        writer: new WebSocketMessageWriter(socket),
      },
    });
    const startedClient = client;
    await startedClient.start();
    commands = registerLspClientCommands(startedClient, {
      workspaceId,
      workspaceRoot,
    });
    openGuard = registerLspOpenGuard(monaco);
    setActiveLspSession(session);
    dirtySync = startDirtyDocumentsSync({
      workspaceId,
      workspaceRoot,
      send: (uris) =>
        void startedClient.sendNotification(LSP_DIRTY_DOCUMENTS_NOTIFICATION, {
          uris,
        }),
    });
    mirror = startDiagnosticsMirror({ monaco, workspaceId, workspaceRoot });
    editSubscription = startedClient.onNotification(
      LSP_EDIT_RESULT_NOTIFICATION,
      (result: LspWorkspaceEditResult) =>
        void handleWorkspaceEditResult(result, {
          monaco,
          workspaceId,
          workspaceRoot,
        }),
    );
    return { workspaceId, dispose };
  } catch (error) {
    await dispose();
    throw error;
  }
}
