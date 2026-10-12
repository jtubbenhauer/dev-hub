import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Range } from "vscode";
import { mocks } from "./lsp-session-mocks";
import {
  createSessionFixture,
  FakeSessionWebSocket,
} from "./lsp-session-fixture";

let session: typeof import("@/lib/lsp/client/lsp-session");
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
  mocks.dirtySync.mockReturnValue({ dispose: mocks.dirtyDispose });
  mocks.registerOverlay.mockReturnValue({ dispose: mocks.overlayDispose });
  mocks.registerOpenGuard.mockReturnValue({ dispose: mocks.openGuardDispose });
  mocks.registerCommands.mockReturnValue({ dispose: mocks.commandsDispose });
  session = await import("@/lib/lsp/client/lsp-session");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("language client session open guard", () => {
  it("registers the open guard on the session Monaco only after the client has started", async () => {
    let finishStart = () => {};
    mocks.start.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishStart = resolve;
        }),
    );
    const connection = session.connectLspSession(options);
    await vi.waitFor(() => expect(mocks.start).toHaveBeenCalledOnce());
    expect(mocks.registerOpenGuard).not.toHaveBeenCalled();
    expect(mocks.registerCommands).not.toHaveBeenCalled();
    expect(session.getActiveLspWorkspaceRoot()).toBeNull();

    finishStart();
    const handle = await connection;

    expect(mocks.registerOpenGuard).toHaveBeenCalledExactlyOnceWith(
      fixture.monaco,
    );
    expect(mocks.start.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.registerOpenGuard.mock.invocationCallOrder[0],
    );
    expect(session.getActiveLspWorkspaceRoot()).toBe("/Workspace");
    expect(mocks.registerCommands).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ start: mocks.start }),
      { workspaceId: "workspace", workspaceRoot: "/Workspace" },
    );
    expect(mocks.start.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.registerCommands.mock.invocationCallOrder[0],
    );
    expect(
      mocks.construct.mock.calls[0][0].clientOptions.middleware,
    ).toMatchObject({
      provideCodeActions: expect.any(Function),
      resolveCodeAction: expect.any(Function),
      provideCodeLenses: expect.any(Function),
      resolveCodeLens: expect.any(Function),
    });
    await handle.dispose();
  });

  it("wires code-lens middleware to the constructed client's converter", async () => {
    const handle = await session.connectLspSession(options);
    const middleware =
      mocks.construct.mock.calls[0][0].clientOptions.middleware;
    const lens = {
      // The middleware forwards the range without inspecting it.
      range: {} as Range,
      isResolved: true,
      command: {
        title: "1 reference",
        command: "editor.action.showReferences",
        arguments: [
          "file:///Workspace/src/b.ts",
          { line: 0, character: 1 },
          [],
        ],
      },
    };
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: vi.fn(),
    };

    await middleware?.resolveCodeLens?.(lens, token, () => lens);

    expect(mocks.asUri).toHaveBeenCalledExactlyOnceWith(
      "file:///Workspace/src/b.ts",
    );
    expect(mocks.asPosition).toHaveBeenCalledExactlyOnceWith({
      line: 0,
      character: 1,
    });
    await handle.dispose();
  });

  it("disposes the open guard once and clears the active root when the session is disposed", async () => {
    const handle = await session.connectLspSession(options);
    expect(mocks.openGuardDispose).not.toHaveBeenCalled();

    await Promise.all([handle.dispose(), handle.dispose()]);

    expect(mocks.openGuardDispose).toHaveBeenCalledOnce();
    expect(mocks.commandsDispose).toHaveBeenCalledOnce();
    expect(session.getActiveLspWorkspaceRoot()).toBeNull();
  });

  it("disposes the open guard before rethrowing when setup fails after registration", async () => {
    mocks.dirtySync.mockImplementation(() => {
      throw new Error("dirty sync failed");
    });

    await expect(session.connectLspSession(options)).rejects.toThrow(
      "dirty sync failed",
    );

    expect(mocks.registerOpenGuard).toHaveBeenCalledOnce();
    expect(mocks.openGuardDispose).toHaveBeenCalledOnce();
    expect(mocks.registerCommands).toHaveBeenCalledOnce();
    expect(mocks.commandsDispose).toHaveBeenCalledOnce();
    expect(session.getActiveLspWorkspaceRoot()).toBeNull();
  });

  it("never registers the open guard when the client fails to start", async () => {
    mocks.start.mockRejectedValue(new Error("initialize failed"));

    await expect(session.connectLspSession(options)).rejects.toThrow(
      "initialize failed",
    );

    expect(mocks.registerOpenGuard).not.toHaveBeenCalled();
    expect(mocks.registerCommands).not.toHaveBeenCalled();
    expect(session.getActiveLspWorkspaceRoot()).toBeNull();
  });

  it("keeps a newer session's root when an older session is disposed later", async () => {
    const olderHandle = await session.connectLspSession(options);
    const newerHandle = await session.connectLspSession({
      ...options,
      workspaceId: "other",
      workspaceRoot: "/Other",
    });

    await olderHandle.dispose();

    expect(session.getActiveLspWorkspaceRoot()).toBe("/Other");
    await newerHandle.dispose();
    expect(session.getActiveLspWorkspaceRoot()).toBeNull();
  });
});
