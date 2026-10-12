import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mocks } from "./lsp-session-mocks";
import {
  createSessionFixture,
  FakeSessionWebSocket,
} from "./lsp-session-fixture";

class TransportWebSocket extends FakeSessionWebSocket {
  static sockets: TransportWebSocket[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;

  constructor(url: string) {
    super(url);
    TransportWebSocket.sockets.push(this);
  }
}

const transportHandlers = {
  onmessage: vi.fn(),
  onerror: vi.fn(),
  onclose: vi.fn(),
};
const clearedHandlers = { onmessage: null, onerror: null, onclose: null };
const options = {
  wsUrl: "ws://localhost:7601",
  workspaceId: "workspace",
  workspaceRoot: "/Workspace",
  onUnexpectedClose: vi.fn(),
};
let session: typeof import("@/lib/lsp/client/lsp-session");

beforeEach(async () => {
  vi.resetModules();
  vi.resetAllMocks();
  FakeSessionWebSocket.instances = [];
  FakeSessionWebSocket.isAutoOpen = true;
  TransportWebSocket.sockets = [];
  vi.stubGlobal("WebSocket", TransportWebSocket);
  mocks.bootstrap.mockResolvedValue(createSessionFixture().monaco);
  mocks.start.mockResolvedValue();
  mocks.dispose.mockResolvedValue();
  mocks.toSocket.mockImplementation((socket: TransportWebSocket) => {
    Object.assign(socket, transportHandlers);
    return socket;
  });
  mocks.registerOverlay.mockReturnValue({ dispose: mocks.overlayDispose });
  mocks.onNotification.mockReturnValue({ dispose: mocks.editDispose });
  mocks.dirtySync.mockReturnValue({ dispose: mocks.dirtyDispose });
  session = await import("@/lib/lsp/client/lsp-session");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("LSP transport handler ownership", () => {
  it("keeps protocol handlers until shutdown settles, then clears them before closing once", async () => {
    // Given
    const shutdown = Promise.withResolvers<void>();
    mocks.dispose.mockReturnValue(shutdown.promise);
    const handle = await session.connectLspSession(options);
    const socket = TransportWebSocket.sockets[0];
    socket.close.mockImplementation(() => {
      expect(socket).toMatchObject(clearedHandlers);
    });

    // When
    const firstDisposal = handle.dispose();
    const secondDisposal = handle.dispose();
    expect(socket).toMatchObject(transportHandlers);
    expect(socket.close).not.toHaveBeenCalled();
    shutdown.resolve();
    await Promise.all([firstDisposal, secondDisposal]);

    // Then
    expect(socket).toMatchObject(clearedHandlers);
    expect(socket.close).toHaveBeenCalledExactlyOnceWith(1000);
    expect(mocks.dispose).toHaveBeenCalledOnce();
    expect(options.onUnexpectedClose).not.toHaveBeenCalled();
  });

  it.each(["reader", "construct", "start"] as const)(
    "clears transport handlers when %s fails during startup",
    async (stage) => {
      // Given
      mocks[stage].mockImplementationOnce(() => {
        throw new Error(`${stage} failed`);
      });

      // When
      await expect(session.connectLspSession(options)).rejects.toThrow(
        `${stage} failed`,
      );

      // Then
      const socket = TransportWebSocket.sockets[0];
      expect(socket).toMatchObject(clearedHandlers);
      expect(socket.close).toHaveBeenCalledExactlyOnceWith(1000);
      expect(options.onUnexpectedClose).not.toHaveBeenCalled();
    },
  );

  it("clears handlers even when client disposal rejects", async () => {
    // Given
    const handle = await session.connectLspSession(options);
    mocks.dispose.mockRejectedValue(new Error("shutdown failed"));
    vi.spyOn(console, "debug").mockImplementation(() => {});

    // When
    await handle.dispose();

    // Then
    const socket = TransportWebSocket.sockets[0];
    expect(socket).toMatchObject(clearedHandlers);
    expect(socket.close).toHaveBeenCalledExactlyOnceWith(1000);
  });

  it("reports an unexpected close once and never reports disposal as unexpected", async () => {
    // Given
    const handle = await session.connectLspSession(options);
    const socket = TransportWebSocket.sockets[0];

    // When
    socket.dispatchEvent(
      new CloseEvent("close", { code: 1006, reason: "lost" }),
    );
    await handle.dispose();
    socket.dispatchEvent(new CloseEvent("close", { code: 1006 }));

    // Then
    expect(options.onUnexpectedClose).toHaveBeenCalledExactlyOnceWith(
      1006,
      "lost",
    );
    expect(socket).toMatchObject(clearedHandlers);
  });
});
