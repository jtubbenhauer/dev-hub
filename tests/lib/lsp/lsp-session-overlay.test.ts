import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mocks } from "./lsp-session-mocks";
import {
  createSessionFixture,
  FakeSessionWebSocket,
} from "./lsp-session-fixture";

let session: typeof import("@/lib/lsp/client/lsp-session");
const workspaceProvider = { kind: "workspace-file-system" };
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
  mocks.bootstrap.mockResolvedValue(createSessionFixture().monaco);
  mocks.start.mockResolvedValue();
  mocks.dispose.mockResolvedValue();
  mocks.toSocket.mockImplementation((socket) => socket);
  mocks.onNotification.mockReturnValue({ dispose: mocks.editDispose });
  mocks.dirtySync.mockReturnValue({ dispose: mocks.dirtyDispose });
  mocks.createFileSystem.mockReturnValue(workspaceProvider);
  mocks.registerOverlay.mockReturnValue({ dispose: mocks.overlayDispose });
  session = await import("@/lib/lsp/client/lsp-session");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("language client session file-system overlay", () => {
  it("registers the workspace overlay after socket open and before client construction or start", async () => {
    FakeSessionWebSocket.isAutoOpen = false;
    const connection = session.connectLspSession(options);
    await vi.waitFor(() =>
      expect(FakeSessionWebSocket.instances).toHaveLength(1),
    );
    expect(mocks.registerOverlay).not.toHaveBeenCalled();
    FakeSessionWebSocket.instances[0].open();
    const handle = await connection;
    expect(mocks.createFileSystem).toHaveBeenCalledExactlyOnceWith({
      workspaceId: "workspace",
      workspaceRoot: "/Workspace",
    });
    expect(mocks.registerOverlay).toHaveBeenCalledExactlyOnceWith(
      1,
      workspaceProvider,
    );
    expect(mocks.registerOverlay.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.construct.mock.invocationCallOrder[0],
    );
    expect(mocks.registerOverlay.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.start.mock.invocationCallOrder[0],
    );
    await Promise.resolve(handle.dispose());
  });

  it("keeps the workspace overlay after dispose and reuses it for the next session", async () => {
    const handle = await session.connectLspSession(options);
    await Promise.all([handle.dispose(), handle.dispose()]);
    const nextHandle = await session.connectLspSession(options);
    await nextHandle.dispose();

    expect(mocks.createFileSystem).toHaveBeenCalledOnce();
    expect(mocks.registerOverlay).toHaveBeenCalledOnce();
    expect(mocks.overlayDispose).not.toHaveBeenCalled();
  });

  it("registers a separate overlay for another workspace root", async () => {
    const handle = await session.connectLspSession(options);
    await handle.dispose();
    const otherHandle = await session.connectLspSession({
      ...options,
      workspaceId: "other",
      workspaceRoot: "/Other",
    });
    await otherHandle.dispose();

    expect(mocks.createFileSystem.mock.calls).toEqual([
      [{ workspaceId: "workspace", workspaceRoot: "/Workspace" }],
      [{ workspaceId: "other", workspaceRoot: "/Other" }],
    ]);
    expect(mocks.overlayDispose).not.toHaveBeenCalled();
  });

  it.each([
    "toSocket",
    "reader",
    "writer",
    "construct",
    "start",
    "registerCommands",
    "registerOpenGuard",
    "dirtySync",
    "onNotification",
  ] as const)(
    "keeps the overlay and closes the socket when %s fails after registration",
    async (stage) => {
      mocks[stage].mockImplementationOnce(() => {
        throw new Error(`${stage} failed`);
      });
      await expect(session.connectLspSession(options)).rejects.toThrow(
        `${stage} failed`,
      );
      expect(mocks.registerOverlay).toHaveBeenCalledOnce();
      expect(mocks.overlayDispose).not.toHaveBeenCalled();
      expect(
        FakeSessionWebSocket.instances[0].close,
      ).toHaveBeenCalledExactlyOnceWith(1000);
      expect(options.onUnexpectedClose).not.toHaveBeenCalled();
    },
  );

  it.each(["createFileSystem", "registerOverlay"] as const)(
    "cleans up without starting the client when %s fails",
    async (stage) => {
      mocks[stage].mockImplementationOnce(() => {
        throw new Error(`${stage} failed`);
      });
      await expect(session.connectLspSession(options)).rejects.toThrow(
        `${stage} failed`,
      );
      expect(mocks.construct).not.toHaveBeenCalled();
      expect(mocks.start).not.toHaveBeenCalled();
      expect(mocks.overlayDispose).not.toHaveBeenCalled();
      expect(
        FakeSessionWebSocket.instances[0].close,
      ).toHaveBeenCalledExactlyOnceWith(1000);
    },
  );
});
