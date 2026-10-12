import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mocks } from "./lsp-session-mocks";
import type { LspWorkspaceEditResult } from "@/lib/lsp/types";
import {
  LSP_DIRTY_DOCUMENTS_NOTIFICATION,
  LSP_EDIT_RESULT_NOTIFICATION,
} from "@/lib/lsp/types";
import {
  createSessionFixture,
  fakeUri,
  FakeSessionWebSocket,
} from "./lsp-session-fixture";

let session: typeof import("@/lib/lsp/client/lsp-session");
let diagnostics: typeof import("@/stores/diagnostics-store").useDiagnosticsStore;
let fixture: ReturnType<typeof createSessionFixture>;
const options = {
  wsUrl: "ws://localhost:7601",
  workspaceId: "workspace",
  workspaceRoot: "/Workspace",
  onUnexpectedClose: vi.fn(),
};

beforeEach(async () => {
  vi.resetModules();
  vi.resetAllMocks();
  FakeSessionWebSocket.instances = [];
  FakeSessionWebSocket.isAutoOpen = true;
  vi.stubGlobal("WebSocket", FakeSessionWebSocket);
  fixture = createSessionFixture();
  mocks.bootstrap.mockResolvedValue(fixture.monaco);
  mocks.start.mockResolvedValue();
  mocks.dispose.mockResolvedValue();
  mocks.toSocket.mockImplementation((socket) => socket);
  mocks.onNotification.mockReturnValue({ dispose: mocks.editDispose });
  mocks.registerOverlay.mockReturnValue({ dispose: mocks.overlayDispose });
  mocks.dirtySync.mockImplementation(({ send }) => {
    send(["file:///Workspace/dirty.ts"]);
    return { dispose: mocks.dirtyDispose };
  });
  session = await import("@/lib/lsp/client/lsp-session");
  diagnostics = (await import("@/stores/diagnostics-store"))
    .useDiagnosticsStore;
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function openConnection() {
  const handle = await session.connectLspSession(options);
  const socket = FakeSessionWebSocket.instances[0];
  return { handle, socket };
}

describe("Monaco language client session", () => {
  it("bootstraps and starts a workspace-scoped client when Monaco is unregistered", async () => {
    const { handle, socket } = await openConnection();
    expect(session.getRegisteredLspMonaco()).toBe(fixture.monaco);
    expect(mocks.suppress).toHaveBeenCalledWith(fixture.monaco);
    expect(mocks.start).toHaveBeenCalledOnce();
    expect(mocks.reader).toHaveBeenCalledWith(socket);
    expect(mocks.writer).toHaveBeenCalledWith(socket);
    const config = mocks.construct.mock.calls[0][0];
    expect(config.clientOptions.documentSelector).toEqual([
      { scheme: "file", language: "typescript", pattern: "/Workspace/**/*" },
      { scheme: "file", language: "javascript", pattern: "/Workspace/**/*" },
    ]);
    expect(config.clientOptions.workspaceFolder).toEqual({
      uri: { path: "/Workspace" },
      name: "Workspace",
      index: 0,
    });
    expect(config.clientOptions.diagnosticCollectionName).toBe("devhub-lsp");
    expect(
      config.clientOptions.errorHandler?.error(new Error(), undefined, 1),
    ).toEqual({ action: 2 });
    expect(config.clientOptions.errorHandler?.closed()).toEqual({ action: 1 });
    await handle.dispose();
  });

  it("reuses the registered Monaco when one already exists", async () => {
    session.registerLspMonacoInstance(fixture.monaco);
    const { handle } = await openConnection();
    expect(mocks.bootstrap).not.toHaveBeenCalled();
    await handle.dispose();
  });

  it("starts dirty reporting only after initialization resolves", async () => {
    let finishStart = () => {};
    mocks.start.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishStart = resolve;
        }),
    );
    const connection = openConnection();
    await vi.waitFor(() => expect(mocks.start).toHaveBeenCalledOnce());
    expect(mocks.dirtySync).not.toHaveBeenCalled();
    finishStart();
    const { handle } = await connection;
    expect(mocks.dirtySync).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "workspace",
        workspaceRoot: "/Workspace",
      }),
    );
    expect(mocks.sendNotification).toHaveBeenCalledWith(
      LSP_DIRTY_DOCUMENTS_NOTIFICATION,
      { uris: ["file:///Workspace/dirty.ts"] },
    );
    await handle.dispose();
    expect(mocks.dirtyDispose).toHaveBeenCalledOnce();
  });

  it("reloads bridge edits when the edit-result notification arrives", async () => {
    const { handle } = await openConnection();
    const result: LspWorkspaceEditResult = {
      applied: true,
      reason: null,
      changedUris: [],
      createdUris: [],
    };
    const registration = mocks.onNotification.mock.calls.find(
      ([method]) => method === LSP_EDIT_RESULT_NOTIFICATION,
    );
    expect(registration).toBeDefined();
    registration?.[1](result);
    expect(mocks.editResult).toHaveBeenCalledWith(result, {
      monaco: fixture.monaco,
      workspaceId: "workspace",
      workspaceRoot: "/Workspace",
    });
    await handle.dispose();
    expect(mocks.editDispose).toHaveBeenCalledOnce();
  });

  it("mirrors only collection markers into the TypeScript source when markers change", async () => {
    const { handle } = await openConnection();
    const resource = fakeUri("file:///Workspace/src/a.ts");
    fixture.editor.getModelMarkers.mockReturnValue(
      [
        "devhub-lsp",
        "devhub-lsp2",
        "typescript",
        "javascript",
        "eslint",
        "other",
      ].map((owner) => ({
        owner,
        resource,
        message: owner,
        severity: 8,
        startLineNumber: 3,
        startColumn: 1,
        endLineNumber: 3,
        endColumn: 2,
      })),
    );
    fixture.editor.onDidChangeMarkers.mock.calls[0][0]([resource]);
    expect(fixture.editor.getModelMarkers).toHaveBeenCalledWith({ resource });
    expect(
      diagnostics
        .getState()
        .diagnosticsBySource.get("workspace:src/a.ts")
        ?.typescript?.map((entry) => entry.message),
    ).toEqual(["devhub-lsp", "devhub-lsp2"]);
    await handle.dispose();
  });

  it("awaits client disposal before socket and marker cleanup when disposed twice", async () => {
    const { handle, socket } = await openConnection();
    let finishDispose = () => {};
    mocks.dispose.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishDispose = resolve;
        }),
    );
    const clear = vi.spyOn(diagnostics.getState(), "clearSourceForWorkspace");
    const disposal = handle.dispose();
    handle.dispose();
    expect(socket.close).not.toHaveBeenCalled();
    finishDispose();
    await disposal;
    expect(mocks.dispose).toHaveBeenCalledOnce();
    expect(socket.close).toHaveBeenCalledExactlyOnceWith(1000);
    expect(fixture.editor.removeAllMarkers).toHaveBeenCalledWith("devhub-lsp");
    expect(socket.close.mock.invocationCallOrder[0]).toBeLessThan(
      fixture.editor.removeAllMarkers.mock.invocationCallOrder[0],
    );
    expect(
      fixture.editor.removeAllMarkers.mock.invocationCallOrder[0],
    ).toBeLessThan(
      fixture.mirrorDisposable.dispose.mock.invocationCallOrder[0],
    );
    expect(
      fixture.mirrorDisposable.dispose.mock.invocationCallOrder[0],
    ).toBeLessThan(clear.mock.invocationCallOrder[0]);
    expect(clear).toHaveBeenCalledWith("workspace", "typescript");
    expect(options.onUnexpectedClose).not.toHaveBeenCalled();
  });

  it("still releases resources when client disposal rejects", async () => {
    const { handle, socket } = await openConnection();
    const error = new Error("stop failed");
    mocks.dispose.mockRejectedValue(error);
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    await handle.dispose();
    expect(debug).toHaveBeenCalledWith("[lsp] dispose", error);
    expect(socket.close).toHaveBeenCalledWith(1000);
    expect(fixture.mirrorDisposable.dispose).toHaveBeenCalledOnce();
  });

  it("reports the socket code and reason when the server closes unexpectedly", async () => {
    const { handle, socket } = await openConnection();
    socket.dispatchEvent(
      new CloseEvent("close", { code: 4004, reason: "lsp-server-exited" }),
    );
    expect(options.onUnexpectedClose).toHaveBeenCalledExactlyOnceWith(
      4004,
      "lsp-server-exited",
    );
    await handle.dispose();
  });

  it("rejects and closes the socket when open takes ten seconds", async () => {
    vi.useFakeTimers();
    FakeSessionWebSocket.isAutoOpen = false;
    const connection = session.connectLspSession(options);
    const rejection = expect(connection).rejects.toThrow(/timed out/);
    await vi.waitFor(() =>
      expect(FakeSessionWebSocket.instances).toHaveLength(1),
    );
    await vi.advanceTimersByTimeAsync(10_000);
    await rejection;
    expect(FakeSessionWebSocket.instances[0].close).toHaveBeenCalledWith(1000);
    expect(mocks.start).not.toHaveBeenCalled();
    expect(options.onUnexpectedClose).not.toHaveBeenCalled();
  });

  it("cleans up a partially created client when initialization fails", async () => {
    mocks.start.mockRejectedValue(new Error("initialize failed"));
    await expect(openConnection()).rejects.toThrow("initialize failed");
    expect(mocks.dispose).toHaveBeenCalledOnce();
    expect(FakeSessionWebSocket.instances[0].close).toHaveBeenCalledWith(1000);
    expect(mocks.dirtySync).not.toHaveBeenCalled();
  });
});
