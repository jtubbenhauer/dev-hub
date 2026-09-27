import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import { Hono } from "hono";
import {
  createServer as createUnixServer,
  type Server as UnixServer,
  type Socket,
} from "node:net";
import { WebSocket } from "ws";
import { omoRpcTunnelRoutes } from "../../src/routes/omo-rpc-tunnel.js";
import type {
  OmoRpcTunnelOptions,
  RpcSocket,
} from "../../src/routes/omo-rpc-tunnel.js";

const unixConnections = new WeakMap<UnixServer, Set<Socket>>();
type AgentServer = ReturnType<typeof serve>;

export type TunnelServer = {
  readonly url: string;
  readonly close: () => Promise<void>;
};

export async function startTunnelServer(
  options: OmoRpcTunnelOptions,
): Promise<TunnelServer> {
  const app = new Hono();
  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });
  app.route("/omo", omoRpcTunnelRoutes(upgradeWebSocket, options));

  const server = serve({
    fetch: app.fetch,
    port: 0,
  });
  injectWebSocket(server);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new TypeError("Expected the tunnel server to listen on a TCP port");
  }

  return {
    url: `ws://127.0.0.1:${address.port}/omo/rpc`,
    close: () => closeHttpServer(server),
  };
}

export async function startEchoUnixServer(
  socketPath: string,
  onFirstChunk: (chunk: Buffer) => void,
): Promise<UnixServer> {
  let hasReceivedChunk = false;
  const server = createUnixServer((socket) => {
    const connections = unixConnections.get(server);
    connections?.add(socket);
    socket.once("close", () => connections?.delete(socket));
    socket.on("data", (chunk: Buffer) => {
      if (!hasReceivedChunk) {
        hasReceivedChunk = true;
        onFirstChunk(chunk);
      }
      socket.write(chunk);
    });
  });
  unixConnections.set(server, new Set());
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, resolve);
  });
  return server;
}

export function openWebSocket(
  url: string,
  authorization?: string,
): Promise<WebSocket> {
  const socket = new WebSocket(url, {
    headers: authorization ? { Authorization: authorization } : undefined,
  });
  return new Promise<WebSocket>((resolve, reject) => {
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
}

export function nextMessage(socket: WebSocket): Promise<string> {
  return new Promise<string>((resolve) => {
    socket.once("message", (data) => resolve(data.toString()));
  });
}

export function nextClose(
  socket: WebSocket,
): Promise<{ readonly code: number; readonly reason: string }> {
  return new Promise((resolve) => {
    socket.once("close", (code, reason) => {
      resolve({ code, reason: reason.toString() });
    });
  });
}

export async function closeUnixServer(server: UnixServer): Promise<void> {
  for (const socket of unixConnections.get(server) ?? []) socket.destroy();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

export async function waitForWrites(
  socket: RpcSocket,
  expectedCount: number,
  getCount: () => number,
): Promise<void> {
  if (getCount() >= expectedCount) return;
  await new Promise<void>((resolve) => {
    const onWrite = (): void => {
      if (getCount() < expectedCount) return;
      socket.removeListener("written", onWrite);
      resolve();
    };
    socket.on("written", onWrite);
  });
}

async function closeHttpServer(server: AgentServer): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
