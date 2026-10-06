// @vitest-environment node
// allow: SIZE_OK — Task 8 requires the complete WebSocket contract in this single test file.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import WebSocket from "ws";
import { workspaceRelativePathToFileUri } from "@/lib/lsp/document-scope";
import { LspServerManager } from "@/lib/lsp/server-manager";
import { closeLspWsServer, ensureLspWsServer } from "@/lib/lsp/ws-server";
import {
  buildLspWsUrl,
  isJsonRpcResponse,
  type JsonRpcResponse,
} from "@/lib/lsp/types";

const fixturePath = path.resolve("tests/fixtures/fake-lsp-server.mjs");
const resolveServerCommand = () => ({
  command: process.execPath,
  args: [fixturePath],
});
const WORKSPACE_ID = "ws-lsp";
const ENV_KEYS = [
  "LSP_SERVER_PORT",
  "LSP_TRACE_FILE",
  "FAKE_LSP_RECORD_FILE",
  "FAKE_LSP_EXIT_ON_HOVER",
  "FAKE_LSP_ASK_CONFIG",
  "FAKE_LSP_IGNORE_SHUTDOWN",
] as const;
const TRACE_KEYS = new Set([
  "ts",
  "dir",
  "kind",
  "method",
  "id",
  "resultNonEmpty",
  "documentInWorkspace",
]);

type TestClient = {
  readonly socket: WebSocket;
  readonly messages: unknown[];
  readonly opened: Promise<void>;
  readonly closed: Promise<{ code: number; reason: string }>;
};

let manager: LspServerManager;
let tempRoot: string;
let workspacePath: string;
let recordFile: string;
let traceFile: string;
let clients: TestClient[];
let blockers: Server[];
let savedEnv: Record<string, string | undefined>;
let originalExitListeners = process.listeners("exit");

function inScopeUri() {
  return workspaceRelativePathToFileUri(workspacePath, "src/a.ts");
}

function connect(url: string): TestClient {
  const socket = new WebSocket(url);
  const messages: unknown[] = [];
  socket.on("message", (data) => messages.push(JSON.parse(data.toString())));
  const opened = new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });
  const closed = new Promise<{ code: number; reason: string }>((resolve) => {
    socket.on("close", (code, reason) =>
      resolve({ code, reason: reason.toString() }),
    );
  });
  const client = { socket, messages, opened, closed };
  clients.push(client);
  return client;
}

function send(client: TestClient, message: Record<string, unknown>) {
  client.socket.send(JSON.stringify({ jsonrpc: "2.0", ...message }));
}

function hover(client: TestClient, id: number, uri: string) {
  send(client, {
    id,
    method: "textDocument/hover",
    params: { textDocument: { uri }, position: { line: 0, character: 0 } },
  });
}

function waitForResponse(
  client: TestClient,
  id: number,
): Promise<JsonRpcResponse> {
  return vi.waitFor(
    () => {
      const response = client.messages.find(
        (message) => isJsonRpcResponse(message) && message.id === id,
      );
      if (!isJsonRpcResponse(response)) throw new Error(`No response ${id}`);
      return response;
    },
    { timeout: 3_000, interval: 10 },
  );
}

async function startAndConnect() {
  const { port } = await ensureLspWsServer(manager);
  await manager.start({ workspaceId: WORKSPACE_ID, workspacePath });
  const client = connect(buildLspWsUrl(port, WORKSPACE_ID, manager.epoch));
  await client.opened;
  return { client, port };
}

function readJsonLines(file: string): Record<string, unknown>[] {
  return readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
}

function recordedMethods(): string[] {
  return readJsonLines(recordFile).flatMap((message) =>
    typeof message.method === "string" ? [message.method] : [],
  );
}

function occupyPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const blocker = createServer();
    blockers.push(blocker);
    blocker.once("error", reject);
    blocker.listen(0, "127.0.0.1", () => {
      const address = blocker.address();
      if (address === null || typeof address === "string") {
        reject(new Error("Expected a TCP address"));
        return;
      }
      resolve(address.port);
    });
  });
}

function freePorts(): Promise<void[]> {
  const closing = blockers.map(
    (blocker) => new Promise<void>((resolve) => blocker.close(() => resolve())),
  );
  blockers = [];
  return Promise.all(closing);
}

beforeEach(() => {
  originalExitListeners = process.listeners("exit");
  savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  tempRoot = realpathSync(mkdtempSync(path.join(tmpdir(), "lsp-ws-")));
  workspacePath = path.join(tempRoot, "workspace");
  mkdirSync(path.join(workspacePath, "src"), { recursive: true });
  writeFileSync(path.join(workspacePath, "src", "a.ts"), "export {};\n");
  recordFile = path.join(tempRoot, "record.jsonl");
  traceFile = path.join(tempRoot, "trace.jsonl");
  process.env.LSP_SERVER_PORT = "0";
  process.env.FAKE_LSP_RECORD_FILE = recordFile;
  delete process.env.LSP_TRACE_FILE;
  delete process.env.FAKE_LSP_EXIT_ON_HOVER;
  delete process.env.FAKE_LSP_ASK_CONFIG;
  delete process.env.FAKE_LSP_IGNORE_SHUTDOWN;
  manager = new LspServerManager({ resolveServerCommand });
  clients = [];
  blockers = [];
});

afterEach(async () => {
  for (const client of clients) client.socket.terminate();
  vi.restoreAllMocks();
  await manager.stop();
  await closeLspWsServer();
  await freePorts();
  for (const key of ENV_KEYS) {
    const value = savedEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  for (const listener of process.listeners("exit")) {
    if (!originalExitListeners.includes(listener))
      process.removeListener("exit", listener);
  }
  rmSync(tempRoot, { recursive: true, force: true });
});

describe("connection checks", () => {
  it("closes with 4003 when the server is not running", async () => {
    const { port } = await ensureLspWsServer(manager);
    const client = connect(buildLspWsUrl(port, WORKSPACE_ID, 1));

    expect(await client.closed).toEqual({
      code: 4003,
      reason: "lsp-not-running",
    });
  });

  it("closes with 4005 when the workspace does not match", async () => {
    const { port } = await ensureLspWsServer(manager);
    await manager.start({ workspaceId: WORKSPACE_ID, workspacePath });
    const client = connect(buildLspWsUrl(port, "other-ws", manager.epoch));

    expect(await client.closed).toEqual({
      code: 4005,
      reason: "lsp-workspace-mismatch",
    });
  });

  it("closes with 4002 when the epoch is stale", async () => {
    const { port } = await ensureLspWsServer(manager);
    await manager.start({ workspaceId: WORKSPACE_ID, workspacePath });
    const client = connect(
      buildLspWsUrl(port, WORKSPACE_ID, manager.epoch + 1),
    );

    expect(await client.closed).toEqual({
      code: 4002,
      reason: "lsp-stale-epoch",
    });
  });

  it("closes a second concurrent client with 4001 and keeps the first", async () => {
    const { client: first, port } = await startAndConnect();
    const second = connect(buildLspWsUrl(port, WORKSPACE_ID, manager.epoch));

    expect(await second.closed).toEqual({ code: 4001, reason: "lsp-busy" });
    expect(first.socket.readyState).toBe(WebSocket.OPEN);
    expect(manager.hasConnection).toBe(true);
  });
});

describe("bridged traffic", () => {
  it("returns initialize capabilities without referencesProvider", async () => {
    const { client } = await startAndConnect();
    send(client, {
      id: 0,
      method: "initialize",
      params: { processId: null, rootUri: null, capabilities: {} },
    });

    const response = await waitForResponse(client, 0);

    expect(response.result).toEqual({
      capabilities: {
        textDocumentSync: 2,
        hoverProvider: true,
        completionProvider: { resolveProvider: true },
      },
    });
  });

  it("answers an inmemory hover with null without reaching the server", async () => {
    const { client } = await startAndConnect();
    hover(client, 1, "inmemory://model/1");
    const inMemoryResponse = await waitForResponse(client, 1);
    hover(client, 2, inScopeUri());
    await waitForResponse(client, 2);

    expect(inMemoryResponse.result).toBeNull();
    const hoverUris = readJsonLines(recordFile)
      .filter((message) => message.method === "textDocument/hover")
      .map((message) => JSON.stringify(message.params));
    expect(hoverUris).toHaveLength(1);
    expect(hoverUris[0]).not.toContain("inmemory");
  });

  it("rejects textDocument/references with -32601 without reaching the server", async () => {
    const { client } = await startAndConnect();
    send(client, {
      id: 3,
      method: "textDocument/references",
      params: {
        textDocument: { uri: inScopeUri() },
        position: { line: 0, character: 0 },
        context: { includeDeclaration: true },
      },
    });
    const response = await waitForResponse(client, 3);
    hover(client, 4, inScopeUri());
    await waitForResponse(client, 4);

    expect(response.error?.code).toBe(-32601);
    expect(recordedMethods()).not.toContain("textDocument/references");
    expect(recordedMethods()).toContain("textDocument/hover");
  });

  it("ignores binary and non-JSON frames", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { client } = await startAndConnect();
    client.socket.send(Buffer.from([0xff, 0x00]), { binary: true });
    client.socket.send("not json");
    hover(client, 5, inScopeUri());

    const response = await waitForResponse(client, 5);

    expect(response.result).toEqual({ contents: "fake-hover" });
    expect(warn).toHaveBeenCalledTimes(2);
  });
});

describe("connection lifetime", () => {
  it("stops the manager within 5s after the client closes", async () => {
    const { client } = await startAndConnect();
    client.socket.close();

    await vi.waitFor(() => expect(manager.state).toBe("stopped"), {
      timeout: 5_000,
      interval: 20,
    });
  });

  it("detaches with the closing connection's own token", async () => {
    const attach = vi.spyOn(manager, "attachConnection");
    const detach = vi.spyOn(manager, "detachConnection");
    const { client: first, port } = await startAndConnect();
    const rejected = connect(buildLspWsUrl(port, WORKSPACE_ID, manager.epoch));
    await rejected.closed;
    const firstToken = attach.mock.results[0]?.value;
    expect(detach).not.toHaveBeenCalled();

    first.socket.close();
    await vi.waitFor(() => expect(manager.state).toBe("stopped"));
    const { client: second } = await startAndConnect();
    const secondToken = attach.mock.results[2]?.value;
    second.socket.close();
    await vi.waitFor(() => expect(detach).toHaveBeenCalledTimes(2));

    expect(typeof firstToken).toBe("number");
    expect(secondToken).not.toBe(firstToken);
    expect(detach.mock.calls).toEqual([[firstToken], [secondToken]]);
  });

  it("closes with 4004 when the server exits", async () => {
    process.env.FAKE_LSP_EXIT_ON_HOVER = "1";
    const { client } = await startAndConnect();
    hover(client, 1, inScopeUri());

    expect(await client.closed).toEqual({
      code: 4004,
      reason: "lsp-server-exited",
    });
  });

  it("closes connected clients with 1001 on closeLspWsServer", async () => {
    const { client } = await startAndConnect();
    await closeLspWsServer();

    expect(await client.closed).toEqual({
      code: 1001,
      reason: "lsp-server-closing",
    });
  });

  it("rejects a client with 4003 while shutting down and accepts one after the restart", async () => {
    process.env.FAKE_LSP_IGNORE_SHUTDOWN = "1";
    const attach = vi.spyOn(manager, "attachConnection");
    const subscribe = vi.spyOn(manager, "onServerMessage");
    const { client: first, port } = await startAndConnect();
    const stoppingEpoch = manager.epoch;
    first.socket.close();
    await vi.waitFor(() => expect(manager.isShuttingDown).toBe(true), {
      timeout: 2_000,
      interval: 10,
    });

    const rejected = connect(buildLspWsUrl(port, WORKSPACE_ID, stoppingEpoch));

    expect(await rejected.closed).toEqual({
      code: 4003,
      reason: "lsp-not-running",
    });
    expect({
      state: manager.state,
      hasConnection: manager.hasConnection,
      attachCalls: attach.mock.calls.length,
      messageSubscriptions: subscribe.mock.calls.length,
    }).toEqual({
      state: "running",
      hasConnection: false,
      attachCalls: 1,
      messageSubscriptions: 1,
    });
    delete process.env.FAKE_LSP_IGNORE_SHUTDOWN;
    await manager.stop();
    const { client: second } = await startAndConnect();
    hover(second, 1, inScopeUri());
    expect((await waitForResponse(second, 1)).result).toEqual({
      contents: "fake-hover",
    });
  }, 15_000);
});

describe("server lifecycle", () => {
  it("shares one initialisation between concurrent callers", () => {
    expect(ensureLspWsServer(manager)).toBe(ensureLspWsServer(manager));
  });

  it("rejects an occupied port with the manager already in error, then recovers", async () => {
    const port = await occupyPort();
    process.env.LSP_SERVER_PORT = String(port);

    const outcome = await ensureLspWsServer(manager).then(
      () => null,
      (error: unknown) => ({ error, stateAtRejection: manager.state }),
    );

    expect(outcome?.error).toBeInstanceOf(Error);
    expect(outcome?.error).toHaveProperty("message", `LSP port ${port} in use`);
    expect(outcome?.stateAtRejection).toBe("error");
    expect(manager.error).toBe(`LSP port ${port} in use`);
    await freePorts();
    await expect(ensureLspWsServer(manager)).resolves.toEqual({ port });
  });

  it("still rejects with the port message when failWithError rejects", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const failWithError = vi
      .spyOn(manager, "failWithError")
      .mockRejectedValue(new Error("x"));
    const port = await occupyPort();
    process.env.LSP_SERVER_PORT = String(port);

    await expect(ensureLspWsServer(manager)).rejects.toThrow(
      `LSP port ${port} in use`,
    );

    expect(failWithError).toHaveBeenCalledWith(`LSP port ${port} in use`);
    expect(warn).toHaveBeenCalledWith(
      "[lsp] failWithError failed",
      expect.any(Error),
    );
    await freePorts();
    await expect(ensureLspWsServer(manager)).resolves.toEqual({ port });
  });

  it("rejects another manager until closeLspWsServer is called", async () => {
    await ensureLspWsServer(manager);
    const otherManager = new LspServerManager({ resolveServerCommand });

    await expect(ensureLspWsServer(otherManager)).rejects.toThrow(
      "bound to another manager",
    );
    await closeLspWsServer();
    await expect(ensureLspWsServer(otherManager)).resolves.toEqual({
      port: expect.any(Number),
    });
  });

  it("tolerates closeLspWsServer twice", async () => {
    await ensureLspWsServer(manager);
    await closeLspWsServer();

    await expect(closeLspWsServer()).resolves.toBeUndefined();
  });

  it("rejects a non-numeric port with the manager in error, then recovers", async () => {
    process.env.LSP_SERVER_PORT = "not-a-port";

    await expect(ensureLspWsServer(manager)).rejects.toThrow(
      "LSP port not-a-port is invalid",
    );

    expect(manager.error).toBe("LSP port not-a-port is invalid");
    process.env.LSP_SERVER_PORT = "0";
    await expect(ensureLspWsServer(manager)).resolves.toEqual({
      port: expect.any(Number),
    });
  });
});

describe("trace file", () => {
  it("writes one param-free line per routed message", async () => {
    process.env.LSP_TRACE_FILE = traceFile;
    process.env.FAKE_LSP_ASK_CONFIG = "1";
    const { client } = await startAndConnect();
    send(client, {
      id: 0,
      method: "initialize",
      params: { processId: null, rootUri: null, capabilities: {} },
    });
    await waitForResponse(client, 0);
    send(client, { method: "initialized", params: {} });
    await vi.waitFor(() => {
      const traced = readJsonLines(traceFile);
      if (!traced.some((line) => line.id === "cfg-1")) throw new Error("wait");
    });
    hover(client, 1, inScopeUri());
    await waitForResponse(client, 1);
    hover(client, 2, "inmemory://model/1");
    await waitForResponse(client, 2);
    send(client, {
      id: 3,
      method: "textDocument/references",
      params: { textDocument: { uri: inScopeUri() } },
    });
    await waitForResponse(client, 3);
    const lines = readJsonLines(traceFile);

    for (const line of lines) {
      expect(Object.keys(line).every((key) => TRACE_KEYS.has(key))).toBe(true);
    }
    const shapes = lines.map(({ ts, ...shape }) => {
      expect(typeof ts).toBe("string");
      return shape;
    });
    expect(shapes).toEqual([
      { dir: "c2s", kind: "request", method: "initialize", id: 0 },
      {
        dir: "s2c",
        kind: "response",
        method: "initialize",
        id: 0,
        resultNonEmpty: true,
      },
      { dir: "c2s", kind: "notification", method: "initialized" },
      {
        dir: "c2s",
        kind: "notification",
        method: "workspace/didChangeConfiguration",
      },
      {
        dir: "c2s",
        kind: "response",
        method: "workspace/configuration",
        id: "cfg-1",
        resultNonEmpty: true,
      },
      {
        dir: "c2s",
        kind: "request",
        method: "textDocument/hover",
        id: 1,
        documentInWorkspace: true,
      },
      {
        dir: "s2c",
        kind: "response",
        method: "textDocument/hover",
        id: 1,
        resultNonEmpty: true,
      },
      {
        dir: "s2c",
        kind: "response",
        method: "textDocument/hover",
        id: 2,
        resultNonEmpty: false,
      },
      {
        dir: "s2c",
        kind: "response",
        method: "textDocument/references",
        id: 3,
        resultNonEmpty: false,
      },
    ]);
  });
});
