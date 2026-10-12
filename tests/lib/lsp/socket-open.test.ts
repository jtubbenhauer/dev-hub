import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  waitForLspSocketOpen,
  LspSocketOpenError,
} from "@/lib/lsp/client/socket-open";
import { FakeSessionWebSocket } from "./lsp-session-fixture";

beforeEach(() => {
  vi.useFakeTimers();
  FakeSessionWebSocket.instances = [];
  FakeSessionWebSocket.isAutoOpen = false;
  vi.stubGlobal("WebSocket", FakeSessionWebSocket);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("LSP socket handshake", () => {
  it.each(["error", "close"])(
    "rejects immediately when the socket emits %s before open",
    async (event) => {
      const socket = new WebSocket("ws://localhost:7601");
      const remove = vi.spyOn(socket, "removeEventListener");
      const opening = waitForLspSocketOpen(socket);
      socket.dispatchEvent(new Event(event));
      await expect(opening).rejects.toBeInstanceOf(LspSocketOpenError);
      expect(remove.mock.calls.map(([name]) => name)).toEqual([
        "open",
        "close",
        "error",
      ]);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("removes handshake listeners and timer when the socket opens", async () => {
    const socket = new WebSocket("ws://localhost:7601");
    const remove = vi.spyOn(socket, "removeEventListener");
    const opening = waitForLspSocketOpen(socket);
    socket.dispatchEvent(new Event("open"));
    await expect(opening).resolves.toBeUndefined();
    expect(remove.mock.calls.map(([name]) => name)).toEqual([
      "open",
      "close",
      "error",
    ]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
