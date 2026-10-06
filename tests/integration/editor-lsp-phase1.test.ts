// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import WebSocket from "ws";
import { LspServerManager } from "@/lib/lsp/server-manager";
import {
  buildLspWsUrl,
  isJsonRpcResponse,
  LSP_CLOSE_CODES,
  type JsonRpcResponse,
} from "@/lib/lsp/types";
import { VTSLS_SETTINGS } from "@/lib/lsp/vtsls-settings";
import { closeLspWsServer, ensureLspWsServer } from "@/lib/lsp/ws-server";

const FIXTURE_SERVER_PATH = path.resolve("tests/fixtures/fake-lsp-server.mjs");
const WORKSPACE_ID = "ws-editor-lsp-phase1";
const WORKSPACE_DIRECTORY_NAME = "Lsp-Workspace";
const IN_MEMORY_URI = "inmemory://model/9";
const OUTSIDE_WORKSPACE_URI = "file:///etc/outside-workspace.ts";
const ENV_KEYS = [
  "LSP_SERVER_PORT",
  "LSP_TRACE_FILE",
  "FAKE_LSP_RECORD_FILE",
  "FAKE_LSP_ASK_CONFIG",
  "FAKE_LSP_EXIT_ON_HOVER",
  "FAKE_LSP_IGNORE_SHUTDOWN",
] as const;
const WORKSPACE_FILES: Readonly<Record<string, string>> = {
  "src/Components/Widget.ts":
    'export class Widget {\n  render(): string {\n    return "widget";\n  }\n}\n',
  "src/view.tsx": 'export const element = <span className="x" />;\n',
  "src/a.ts": "export const total: number = 1;\n",
  "src/100%.ts": 'export const percent: number = "p";\n',
  "src/my file.ts": "export const spaced = 1;\n",
  "src/my%20file.ts": 'export const literalEscape: number = "e";\n',
};
const NATIVE_CLIENT_CAPABILITIES = {
  textDocument: {
    synchronization: { dynamicRegistration: true, didSave: true },
    publishDiagnostics: { relatedInformation: true, versionSupport: true },
    hover: { contentFormat: ["markdown", "plaintext"] },
    completion: { completionItem: { snippetSupport: true } },
    signatureHelp: { dynamicRegistration: true },
    definition: { linkSupport: true },
    references: { dynamicRegistration: true },
    rename: { dynamicRegistration: true, prepareSupport: true },
    codeAction: { dynamicRegistration: true },
    inlayHint: { dynamicRegistration: true },
  },
  workspace: { applyEdit: true },
};

type TestClient = {
  readonly socket: WebSocket;
  readonly messages: unknown[];
  readonly closed: Promise<{ code: number; reason: string }>;
};

let manager: LspServerManager;
let tempRoot: string;
let workspacePath: string;
let recordFile: string;
let wsPort: number;
let clients: TestClient[];
let spawnedChildren: ChildProcess[];
let savedEnv: Record<string, string | undefined>;
let originalExitListeners = process.listeners("exit");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function realCaseUri(relativePath: string): string {
  return pathToFileURL(path.join(workspacePath, relativePath)).href;
}

function nativeClientUri(relativePath: string): string {
  return realCaseUri(relativePath).toLowerCase();
}

async function startServerAndConnect(): Promise<TestClient> {
  await manager.start({ workspaceId: WORKSPACE_ID, workspacePath });
  const url = buildLspWsUrl(wsPort, WORKSPACE_ID, manager.epoch);
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
  const client = { socket, messages, closed };
  clients.push(client);
  await opened;
  return client;
}

function send(client: TestClient, message: Record<string, unknown>) {
  client.socket.send(JSON.stringify({ jsonrpc: "2.0", ...message }));
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

function sendHover(client: TestClient, id: number, uri: string) {
  send(client, {
    id,
    method: "textDocument/hover",
    params: { textDocument: { uri }, position: { line: 0, character: 0 } },
  });
}

function hover(client: TestClient, id: number, uri: string) {
  sendHover(client, id, uri);
  return waitForResponse(client, id);
}

function didOpen(client: TestClient, uri: string) {
  send(client, {
    method: "textDocument/didOpen",
    params: {
      textDocument: { uri, languageId: "typescript", version: 1, text: "" },
    },
  });
}

function readRecordedMessages(): Record<string, unknown>[] {
  if (!existsSync(recordFile)) return [];
  return readFileSync(recordFile, "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .flatMap((line) => {
      const parsed: unknown = JSON.parse(line);
      return isRecord(parsed) ? [parsed] : [];
    });
}

function recordedDidOpenDocuments(): Record<string, unknown>[] {
  return readRecordedMessages()
    .filter((message) => message.method === "textDocument/didOpen")
    .flatMap((message) => {
      const params = message.params;
      return isRecord(params) && isRecord(params.textDocument)
        ? [params.textDocument]
        : [];
    });
}

async function waitForRecordedMessage(
  predicate: (message: Record<string, unknown>) => boolean,
): Promise<Record<string, unknown>> {
  return vi.waitFor(
    () => {
      const found = readRecordedMessages().find(predicate);
      if (found === undefined) throw new Error("message not recorded yet");
      return found;
    },
    { timeout: 3_000, interval: 10 },
  );
}

async function initializeLikeNativeClient(client: TestClient) {
  send(client, {
    id: 0,
    method: "initialize",
    params: {
      processId: null,
      rootUri: null,
      capabilities: NATIVE_CLIENT_CAPABILITIES,
    },
  });
  const initializeResponse = await waitForResponse(client, 0);
  send(client, { method: "initialized", params: {} });
  return initializeResponse;
}

async function runNativeClientSessionOnFreshServer() {
  const client = await startServerAndConnect();
  const initializeResponse = await initializeLikeNativeClient(client);
  await waitForRecordedMessage((message) => message.id === "cfg-1");
  for (const relativePath of Object.keys(WORKSPACE_FILES)) {
    didOpen(client, nativeClientUri(relativePath));
  }
  didOpen(client, IN_MEMORY_URI);
  const inScopeHover = await hover(client, 1, nativeClientUri("src/a.ts"));
  const inMemoryHover = await hover(client, 2, IN_MEMORY_URI);
  const outsideHover = await hover(client, 3, OUTSIDE_WORKSPACE_URI);
  return { initializeResponse, inScopeHover, inMemoryHover, outsideHover };
}

function latestSpawnedPid(): number {
  const pid = spawnedChildren.at(-1)?.pid;
  if (pid === undefined) throw new Error("fake server was never spawned");
  return pid;
}

function waitForProcessExit(pid: number) {
  return vi.waitFor(() => expect(() => process.kill(pid, 0)).toThrow(), {
    timeout: 5_000,
    interval: 20,
  });
}

beforeEach(async () => {
  originalExitListeners = process.listeners("exit");
  savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  tempRoot = realpathSync(mkdtempSync(path.join(tmpdir(), "editor-lsp-p1-")));
  workspacePath = path.join(tempRoot, WORKSPACE_DIRECTORY_NAME);
  recordFile = path.join(tempRoot, "fake-lsp-record.jsonl");
  for (const [relativePath, content] of Object.entries(WORKSPACE_FILES)) {
    const absolutePath = path.join(workspacePath, relativePath);
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, content);
  }
  process.env.LSP_SERVER_PORT = "0";
  process.env.FAKE_LSP_RECORD_FILE = recordFile;
  process.env.FAKE_LSP_ASK_CONFIG = "1";
  delete process.env.LSP_TRACE_FILE;
  delete process.env.FAKE_LSP_EXIT_ON_HOVER;
  delete process.env.FAKE_LSP_IGNORE_SHUTDOWN;
  clients = [];
  spawnedChildren = [];
  manager = new LspServerManager({
    resolveServerCommand: () => ({
      command: process.execPath,
      args: [FIXTURE_SERVER_PATH],
    }),
    spawnImpl: (command, args, options) => {
      const child = spawn(command, args, options);
      spawnedChildren.push(child);
      return child;
    },
  });
  ({ port: wsPort } = await ensureLspWsServer(manager));
});

afterEach(async () => {
  for (const client of clients) client.socket.terminate();
  await manager.stop();
  await closeLspWsServer();
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

describe("native client traffic through the bridge", () => {
  it("sends initialize with the real-case rootUri and workspaceFolders", async () => {
    await runNativeClientSessionOnFreshServer();

    const initialize = await waitForRecordedMessage(
      (message) => message.method === "initialize",
    );
    const rootUri = pathToFileURL(workspacePath).href;
    expect(initialize.params).toMatchObject({
      rootUri,
      workspaceFolders: [{ uri: rootUri, name: WORKSPACE_DIRECTORY_NAME }],
      capabilities: {
        textDocument: NATIVE_CLIENT_CAPABILITIES.textDocument,
      },
    });
  });

  it("forwards each workspace didOpen once with its real-case URI", async () => {
    await runNativeClientSessionOnFreshServer();

    const openedUris = recordedDidOpenDocuments().map(
      (document) => document.uri,
    );
    const expectedUris = Object.keys(WORKSPACE_FILES).map(realCaseUri);
    expect([...openedUris].sort()).toEqual([...expectedUris].sort());
    expect(openedUris).toContain(realCaseUri("src/Components/Widget.ts"));
  });

  it("keeps %, space and literal %20 file names as three distinct URIs", async () => {
    await runNativeClientSessionOnFreshServer();

    const openedUris = recordedDidOpenDocuments().map(
      (document) => document.uri,
    );
    const unusualSuffixes = ["100%25.ts", "my%20file.ts", "my%2520file.ts"];
    const matchedUris = unusualSuffixes.map((suffix) => {
      const matches = openedUris.filter(
        (uri) => typeof uri === "string" && uri.endsWith(`/src/${suffix}`),
      );
      expect(matches).toHaveLength(1);
      return matches[0];
    });
    expect(new Set(matchedUris).size).toBe(3);
  });

  it("rewrites the tsx languageId to typescriptreact", async () => {
    await runNativeClientSessionOnFreshServer();

    const viewDocument = recordedDidOpenDocuments().find(
      (document) => document.uri === realCaseUri("src/view.tsx"),
    );
    expect(viewDocument?.languageId).toBe("typescriptreact");
  });

  it("never forwards the inmemory model", async () => {
    await runNativeClientSessionOnFreshServer();

    const recordedText = readFileSync(recordFile, "utf8");
    expect(recordedText).not.toContain("inmemory");
  });

  it("answers workspace/configuration with the typescript.inlayHints section", async () => {
    await runNativeClientSessionOnFreshServer();

    const configurationAnswer = await waitForRecordedMessage(
      (message) => message.id === "cfg-1",
    );
    expect(configurationAnswer.result).toEqual([
      VTSLS_SETTINGS.typescript.inlayHints,
    ]);
  });

  it("returns initialize id 0 capabilities without referencesProvider", async () => {
    const { initializeResponse } = await runNativeClientSessionOnFreshServer();

    expect(initializeResponse.id).toBe(0);
    const capabilities = isRecord(initializeResponse.result)
      ? initializeResponse.result.capabilities
      : undefined;
    expect(capabilities).toHaveProperty("hoverProvider", true);
    expect(capabilities).not.toHaveProperty("referencesProvider");
  });

  it("returns fake-hover in scope and null out of scope", async () => {
    const { inScopeHover, inMemoryHover, outsideHover } =
      await runNativeClientSessionOnFreshServer();

    expect(inScopeHover.result).toEqual({ contents: "fake-hover" });
    expect(inMemoryHover.result).toBeNull();
    expect(outsideHover.result).toBeNull();
  });
});

describe("connection lifecycle", () => {
  it("stops the fake server process within 5 s after the client closes", async () => {
    const client = await startServerAndConnect();
    await initializeLikeNativeClient(client);
    const pid = latestSpawnedPid();

    client.socket.close();

    await waitForProcessExit(pid);
  });

  it("accepts a new client on epoch + 1 after a restart", async () => {
    const firstClient = await startServerAndConnect();
    const firstEpoch = manager.epoch;
    const firstPid = latestSpawnedPid();
    firstClient.socket.close();
    await waitForProcessExit(firstPid);

    const secondClient = await startServerAndConnect();

    expect(manager.epoch).toBe(firstEpoch + 1);
    const response = await initializeLikeNativeClient(secondClient);
    expect(response.result).toHaveProperty("capabilities");
  });
});

describe("crash", () => {
  it("closes the client with 4004 when the server exits on hover", async () => {
    process.env.FAKE_LSP_EXIT_ON_HOVER = "1";
    const client = await startServerAndConnect();
    await initializeLikeNativeClient(client);

    sendHover(client, 1, nativeClientUri("src/a.ts"));

    expect(await client.closed).toEqual({
      code: LSP_CLOSE_CODES.SERVER_EXITED,
      reason: "lsp-server-exited",
    });
  });

  it("serves hover to a new client on epoch + 1 after the crash", async () => {
    process.env.FAKE_LSP_EXIT_ON_HOVER = "1";
    const crashedClient = await startServerAndConnect();
    const crashedEpoch = manager.epoch;
    sendHover(crashedClient, 1, nativeClientUri("src/a.ts"));
    await crashedClient.closed;
    delete process.env.FAKE_LSP_EXIT_ON_HOVER;

    const recoveredClient = await startServerAndConnect();
    await initializeLikeNativeClient(recoveredClient);
    const inScopeUri = nativeClientUri("src/a.ts");
    didOpen(recoveredClient, inScopeUri);
    const hoverResponse = await hover(recoveredClient, 2, inScopeUri);

    expect(manager.epoch).toBe(crashedEpoch + 1);
    expect(hoverResponse.result).toEqual({ contents: "fake-hover" });
  });
});
