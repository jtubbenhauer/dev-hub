// @vitest-environment node

import type { IncomingMessage } from "node:http";
import { once } from "node:events";
import type { Duplex } from "node:stream";
import WebSocket, { WebSocketServer } from "ws";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OmoRpcClient, WebSocketTransport } from "@/lib/omo/rpc-client";
import { OmoTransportGoneError } from "@/lib/omo/errors";

const REQUIRED_CAPABILITIES = [
  "multi_session",
  "retain_on_disconnect",
  "session_kind",
  "session_context",
  "extension_events",
] as const;

type TestServer = {
  readonly url: string;
  readonly server: WebSocketServer;
};

const servers: WebSocketServer[] = [];
const clients: OmoRpcClient[] = [];
const streams: Duplex[] = [];

async function startServer(): Promise<TestServer> {
  const server = new WebSocketServer({ port: 0, path: "/omo/rpc" });
  servers.push(server);
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new TypeError("WebSocket test server did not bind a TCP port");
  }
  return {
    server,
    url: `ws://127.0.0.1:${address.port}/omo/rpc`,
  };
}

function waitForConnection(server: WebSocketServer): Promise<{
  readonly socket: WebSocket;
  readonly request: IncomingMessage;
}> {
  return new Promise((resolve) => {
    server.once("connection", (socket, request) => {
      resolve({ socket, request });
    });
  });
}

function waitForData(stream: Duplex): Promise<string> {
  return new Promise((resolve) => {
    stream.once("data", (chunk: Buffer | string) => {
      resolve(chunk.toString());
    });
  });
}

function waitForClientEvent(client: OmoRpcClient, type: string): Promise<void> {
  return new Promise((resolve) => {
    const stop = client.on((record) => {
      if (record["type"] !== type) return;
      stop();
      resolve();
    });
  });
}

afterEach(async () => {
  for (const client of clients.splice(0)) client.close();
  for (const stream of streams.splice(0)) stream.destroy();
  for (const server of servers.splice(0)) {
    for (const socket of server.clients) socket.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

describe("WebSocketTransport", () => {
  it("round-trips JSONL records as authenticated text frames", async () => {
    const { server, url } = await startServer();
    const connected = waitForConnection(server);
    const stream = await new WebSocketTransport({
      url,
      token: "secret-token",
    }).connect();
    streams.push(stream);
    const { socket: serverSocket, request } = await connected;
    const received = once(serverSocket, "message");
    const response = waitForData(stream);

    stream.write('{"type":"client_record"}\n');
    const [clientFrame, isBinary] = await received;
    serverSocket.send('{"type":"server_record"}');

    expect(isBinary).toBe(false);
    expect(clientFrame.toString()).toBe('{"type":"client_record"}');
    await expect(response).resolves.toBe('{"type":"server_record"}\n');
    expect(request.headers.authorization).toBe("Bearer secret-token");
    expect(request.url).toBe("/omo/rpc");
  });

  it("emits the client disconnect event when the server closes", async () => {
    const { server, url } = await startServer();
    server.on("connection", (socket) => {
      socket.on("message", (data) => {
        const record: unknown = JSON.parse(data.toString());
        if (
          typeof record !== "object" ||
          record === null ||
          !("id" in record) ||
          typeof record.id !== "string" ||
          !("type" in record) ||
          typeof record.type !== "string"
        ) {
          return;
        }
        socket.send(
          JSON.stringify({
            type: "response",
            id: record.id,
            command: record.type,
            success: true,
            ...(record.type === "get_protocol_info"
              ? {
                  data: {
                    protocolVersion: 1,
                    mode: "multi",
                    capabilities: REQUIRED_CAPABILITIES,
                  },
                }
              : {}),
          }),
        );
      });
    });
    const client = new OmoRpcClient({
      transport: new WebSocketTransport({ url, token: "secret-token" }),
    });
    clients.push(client);
    await client.connect();
    const disconnected = waitForClientEvent(client, "__devhub_disconnected");

    for (const socket of server.clients) socket.close();

    await expect(disconnected).resolves.toBeUndefined();
  });

  it("refuses to connect to a non-loopback origin without ever sending the bearer token", async () => {
    const connectionAttempted = vi.fn();
    const { server } = await startServer();
    server.on("connection", connectionAttempted);

    await expect(
      new WebSocketTransport({
        url: "ws://agent.example.com:7500/omo/rpc",
        token: "secret-token",
      }).connect(),
    ).rejects.toBeInstanceOf(OmoTransportGoneError);

    expect(connectionAttempted).not.toHaveBeenCalled();
  });

  it("closes the connection when the server sends a frame over the 16 MiB cap", async () => {
    const { server, url } = await startServer();
    const connected = waitForConnection(server);
    const stream = await new WebSocketTransport({
      url,
      token: "secret-token",
    }).connect();
    streams.push(stream);
    const { socket: serverSocket } = await connected;
    const errored = new Promise<void>((resolve) => {
      stream.once("error", () => resolve());
    });

    serverSocket.send("x".repeat(16 * 1024 * 1024 + 1));

    await errored;
  });
});
