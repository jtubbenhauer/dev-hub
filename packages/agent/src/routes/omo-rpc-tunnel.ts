import type { NodeWebSocket } from "@hono/node-ws";
import { Hono } from "hono";
import type { EventEmitter } from "node:events";
import { homedir } from "node:os";
import { join } from "node:path";
import { createConnection } from "node:net";
import { isAuthorizedBearer } from "../omo/auth.js";
import { createJsonlLineDecoder, encodeJsonlLine } from "../omo/jsonl.js";

const HIGH_WATER_BYTES = 8 * 1024 * 1024;
const LOW_WATER_BYTES = 2 * 1024 * 1024;
const BACKPRESSURE_POLL_MS = 50;

export interface RpcSocket extends EventEmitter {
  readonly destroyed: boolean;
  write(data: string): boolean;
  pause(): this;
  resume(): this;
  destroy(): this;
}

export interface TunnelWebSocket {
  readonly raw?: { readonly bufferedAmount: number };
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export type OmoRpcTunnelOptions = {
  readonly socketPath?: string;
  readonly connectSocket?: (socketPath: string) => RpcSocket;
};

type QueuedFrame = {
  readonly line: string;
  readonly bytes: number;
};

export function omoRpcTunnelRoutes(
  upgradeWebSocket: NodeWebSocket["upgradeWebSocket"],
  options: OmoRpcTunnelOptions = {},
): Hono {
  const app = new Hono();

  app.get(
    "/rpc",
    upgradeWebSocket((context) => {
      const isAuthorized = isAuthorizedBearer(
        context.req.header("Authorization"),
        process.env.DEVHUB_AGENT_TOKEN,
      );
      let tunnel: OmoRpcTunnel | undefined;

      return {
        onOpen: (_event, webSocket) => {
          if (!isAuthorized) {
            webSocket.close(4401, "Unauthorized");
            return;
          }
          tunnel = new OmoRpcTunnel(webSocket, options);
          tunnel.open();
        },
        onMessage: (event) => {
          tunnel?.receiveWebSocketMessage(event.data);
        },
        onClose: () => {
          tunnel?.closeFromWebSocket();
        },
        onError: () => {
          tunnel?.closeFromWebSocket();
        },
      };
    }),
  );

  return app;
}

export class OmoRpcTunnel {
  private readonly webSocket: TunnelWebSocket;
  private readonly options: OmoRpcTunnelOptions;
  private readonly queuedFrames: QueuedFrame[] = [];
  private rpcSocket: RpcSocket | undefined;
  private queuedBytes = 0;
  private isSocketWriteBlocked = false;
  private isClosed = false;
  private backpressureTimer: ReturnType<typeof setInterval> | undefined;

  constructor(webSocket: TunnelWebSocket, options: OmoRpcTunnelOptions) {
    this.webSocket = webSocket;
    this.options = options;
  }

  open(): void {
    const socketPath = this.options.socketPath ?? resolveOmoSocketPath();
    const connectSocket = this.options.connectSocket ?? createConnection;
    const rpcSocket = connectSocket(socketPath);
    this.rpcSocket = rpcSocket;

    const decoder = createJsonlLineDecoder(
      (line) => this.sendSocketLine(line),
      () => this.close(1009, "RPC record too large"),
    );
    rpcSocket.on("data", (chunk: Buffer | string) => decoder.write(chunk));
    rpcSocket.on("drain", () => this.flushQueuedFrames());
    rpcSocket.on("error", () => this.close(1011, "RPC socket error"));
    rpcSocket.on("close", () => {
      decoder.end();
      this.close(1011, "RPC socket closed");
    });
  }

  receiveWebSocketMessage(message: string | Blob | ArrayBufferLike): void {
    if (typeof message !== "string") {
      this.close(1003, "Text frames only");
      return;
    }
    const line = encodeJsonlLine(message);
    const bytes = Buffer.byteLength(line);
    const rpcSocket = this.rpcSocket;
    if (!rpcSocket || this.isSocketWriteBlocked) {
      this.enqueueFrame({ line, bytes });
      return;
    }
    this.isSocketWriteBlocked = !rpcSocket.write(line);
  }

  closeFromWebSocket(): void {
    if (this.isClosed) return;
    this.isClosed = true;
    this.clearBackpressureTimer();
    this.rpcSocket?.destroy();
  }

  private enqueueFrame(frame: QueuedFrame): void {
    if (this.queuedBytes + frame.bytes > HIGH_WATER_BYTES) {
      this.close(1013, "Try again later");
      return;
    }
    this.queuedFrames.push(frame);
    this.queuedBytes += frame.bytes;
  }

  private flushQueuedFrames(): void {
    const rpcSocket = this.rpcSocket;
    if (!rpcSocket || this.isClosed) return;
    this.isSocketWriteBlocked = false;
    while (this.queuedFrames.length > 0) {
      const frame = this.queuedFrames.shift();
      if (!frame) return;
      this.queuedBytes -= frame.bytes;
      if (!rpcSocket.write(frame.line)) {
        this.isSocketWriteBlocked = true;
        return;
      }
    }
  }

  private sendSocketLine(line: string): void {
    if (this.isClosed || this.webSocket.readyState !== 1) return;
    this.webSocket.send(line);
    const bufferedAmount = this.webSocket.raw?.bufferedAmount ?? 0;
    if (bufferedAmount <= HIGH_WATER_BYTES || this.backpressureTimer) return;

    this.rpcSocket?.pause();
    this.backpressureTimer = setInterval(() => {
      const currentBufferedAmount = this.webSocket.raw?.bufferedAmount ?? 0;
      if (currentBufferedAmount >= LOW_WATER_BYTES) return;
      this.clearBackpressureTimer();
      this.rpcSocket?.resume();
    }, BACKPRESSURE_POLL_MS);
  }

  private close(code: number, reason: string): void {
    if (this.isClosed) return;
    this.isClosed = true;
    this.clearBackpressureTimer();
    if (this.webSocket.readyState === 0 || this.webSocket.readyState === 1) {
      this.webSocket.close(code, reason);
    }
    this.rpcSocket?.destroy();
  }

  private clearBackpressureTimer(): void {
    if (!this.backpressureTimer) return;
    clearInterval(this.backpressureTimer);
    this.backpressureTimer = undefined;
  }
}

function resolveOmoSocketPath(): string {
  if (process.env.OMO_RPC_SOCKET) return process.env.OMO_RPC_SOCKET;
  const agentDirectory =
    process.env.OMO_CODING_AGENT_DIR ??
    process.env.SENPI_CODING_AGENT_DIR ??
    join(homedir(), ".omo", "agent");
  return join(agentDirectory, "rpc", "rpc.sock");
}
