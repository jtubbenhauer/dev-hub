import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server as UnixServer } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WebSocket } from "ws";
import { OmoRpcTunnel } from "../../src/routes/omo-rpc-tunnel.js";
import type {
  RpcSocket,
  TunnelWebSocket,
} from "../../src/routes/omo-rpc-tunnel.js";
import {
  closeUnixServer,
  nextClose,
  nextMessage,
  openWebSocket,
  startEchoUnixServer,
  startTunnelServer,
  type TunnelServer,
  waitForWrites,
} from "../helpers/omo-rpc-tunnel.js";

const TOKEN = "test-agent-token";

class SlowRpcSocket extends EventEmitter implements RpcSocket {
  readonly writes: string[] = [];
  destroyed = false;
  isPaused = false;
  pauseCount = 0;
  resumeCount = 0;

  write(data: string): boolean {
    this.writes.push(data);
    this.emit("written");
    return this.writes.length !== 1;
  }

  pause(): this {
    this.isPaused = true;
    this.pauseCount += 1;
    return this;
  }

  resume(): this {
    this.isPaused = false;
    this.resumeCount += 1;
    return this;
  }

  destroy(): this {
    if (this.destroyed) return this;
    this.destroyed = true;
    this.emit("close");
    return this;
  }
}

describe("GET /omo/rpc", () => {
  let directory: string;
  let socketPath: string;
  let unixServer: UnixServer | undefined;
  let tunnelServer: TunnelServer | undefined;
  let webSocket: WebSocket | undefined;

  beforeEach(async () => {
    process.env.DEVHUB_AGENT_TOKEN = TOKEN;
    directory = await mkdtemp(join(tmpdir(), "devhub-agent-tunnel-"));
    socketPath = join(directory, "rpc.sock");
  });

  afterEach(async () => {
    webSocket?.terminate();
    await tunnelServer?.close();
    if (unixServer?.listening) await closeUnixServer(unixServer);
    await rm(directory, { recursive: true, force: true });
    delete process.env.DEVHUB_AGENT_TOKEN;
  });

  it("closes with 4401 when the authorization header is missing", async () => {
    tunnelServer = await startTunnelServer({ socketPath });
    webSocket = await openWebSocket(tunnelServer.url);

    await expect(nextClose(webSocket)).resolves.toMatchObject({ code: 4401 });
  });

  it("closes with 4401 when the bearer token is wrong", async () => {
    tunnelServer = await startTunnelServer({ socketPath });
    webSocket = await openWebSocket(
      tunnelServer.url,
      "Bearer wrong-agent-token",
    );

    await expect(nextClose(webSocket)).resolves.toMatchObject({ code: 4401 });
  });

  it("ignores a valid token in the query string", async () => {
    tunnelServer = await startTunnelServer({ socketPath });
    webSocket = await openWebSocket(`${tunnelServer.url}?token=${TOKEN}`);

    await expect(nextClose(webSocket)).resolves.toMatchObject({ code: 4401 });
  });

  it("round-trips JSONL without writing handshake bytes", async () => {
    let firstChunk: Buffer | undefined;
    unixServer = await startEchoUnixServer(socketPath, (chunk) => {
      firstChunk = chunk;
    });
    tunnelServer = await startTunnelServer({ socketPath });
    webSocket = await openWebSocket(tunnelServer.url, `Bearer ${TOKEN}`);
    const response = nextMessage(webSocket);

    webSocket.send('{"type":"ping"}');

    await expect(response).resolves.toBe('{"type":"ping"}');
    const firstLine = firstChunk?.toString().split("\n", 1)[0] ?? "";
    expect(JSON.parse(firstLine)).toEqual({ type: "ping" });
  });

  it("closes the WebSocket when the unix socket closes", async () => {
    unixServer = await startEchoUnixServer(socketPath, () => undefined);
    tunnelServer = await startTunnelServer({ socketPath });
    webSocket = await openWebSocket(tunnelServer.url, `Bearer ${TOKEN}`);
    const closed = nextClose(webSocket);

    await closeUnixServer(unixServer);
    unixServer = undefined;

    await expect(closed).resolves.toMatchObject({ code: 1011 });
  });

  it("buffers frames until a slow unix socket drains", async () => {
    const slowSocket = new SlowRpcSocket();
    tunnelServer = await startTunnelServer({
      socketPath,
      connectSocket: () => slowSocket,
    });
    webSocket = await openWebSocket(tunnelServer.url, `Bearer ${TOKEN}`);

    webSocket.send('{"sequence":1}');
    await waitForWrites(slowSocket, 1, () => slowSocket.writes.length);
    webSocket.send('{"sequence":2}');
    webSocket.send('{"sequence":3}');
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(slowSocket.writes).toEqual(['{"sequence":1}\n']);

    slowSocket.emit("drain");
    await waitForWrites(slowSocket, 3, () => slowSocket.writes.length);
    expect(slowSocket.writes).toEqual([
      '{"sequence":1}\n',
      '{"sequence":2}\n',
      '{"sequence":3}\n',
    ]);
  });

  it("closes with 1013 when the slow-socket buffer exceeds 8 MiB", async () => {
    const slowSocket = new SlowRpcSocket();
    tunnelServer = await startTunnelServer({
      socketPath,
      connectSocket: () => slowSocket,
    });
    webSocket = await openWebSocket(tunnelServer.url, `Bearer ${TOKEN}`);
    webSocket.send('{"sequence":1}');
    await waitForWrites(slowSocket, 1, () => slowSocket.writes.length);
    const closed = nextClose(webSocket);

    webSocket.send(`{"payload":"${"x".repeat(8 * 1024 * 1024)}"}`);

    await expect(closed).resolves.toMatchObject({ code: 1013 });
  });

  it("destroys the unix socket when the WebSocket closes", async () => {
    const rpcSocket = new SlowRpcSocket();
    tunnelServer = await startTunnelServer({
      socketPath,
      connectSocket: () => rpcSocket,
    });
    webSocket = await openWebSocket(tunnelServer.url, `Bearer ${TOKEN}`);
    const socketClosed = new Promise<void>((resolve) => {
      rpcSocket.once("close", resolve);
    });

    webSocket.close(1000);

    await socketClosed;
    expect(rpcSocket.destroyed).toBe(true);
  });
});

describe("socket-to-WebSocket backpressure", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("pauses above 8 MiB and resumes below 2 MiB on 50ms polls", () => {
    const rpcSocket = new SlowRpcSocket();
    const rawWebSocket = { bufferedAmount: 8 * 1024 * 1024 };
    const webSocket = {
      raw: rawWebSocket,
      readyState: 1,
      send: vi.fn(),
      close: vi.fn(),
    } satisfies TunnelWebSocket;
    const tunnel = new OmoRpcTunnel(webSocket, {
      connectSocket: () => rpcSocket,
    });
    tunnel.open();

    rpcSocket.emit("data", Buffer.from('{"atThreshold":true}\n'));
    expect(rpcSocket.pauseCount).toBe(0);

    rawWebSocket.bufferedAmount = 8 * 1024 * 1024 + 1;
    rpcSocket.emit("data", Buffer.from('{"aboveThreshold":true}\n'));
    expect(rpcSocket.pauseCount).toBe(1);

    rawWebSocket.bufferedAmount = 2 * 1024 * 1024;
    vi.advanceTimersByTime(50);
    expect(rpcSocket.resumeCount).toBe(0);

    rawWebSocket.bufferedAmount = 2 * 1024 * 1024 - 1;
    vi.advanceTimersByTime(49);
    expect(rpcSocket.resumeCount).toBe(0);
    vi.advanceTimersByTime(1);
    expect(rpcSocket.resumeCount).toBe(1);

    tunnel.closeFromWebSocket();
  });
});
