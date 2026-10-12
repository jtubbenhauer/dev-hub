// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
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
import { LspServerManager } from "@/lib/lsp/server-manager";
import {
  buildLspWsUrl,
  isLspRecord,
  LSP_DIRTY_DOCUMENTS_NOTIFICATION,
  LSP_EDIT_RESULT_NOTIFICATION,
} from "@/lib/lsp/types";
import { closeLspWsServer, ensureLspWsServer } from "@/lib/lsp/ws-server";
import {
  connectClient,
  FIXTURE_SERVER_PATH,
  PHASE2_WORKSPACE_FILES,
  recordedMethods,
  send,
  waitForNotificationParams,
  waitForRecordedMessage,
  waitForResponse,
  type TestClient,
} from "./lsp-phase2-harness";

const WORKSPACE_ID = "ws-editor-lsp-phase2";
const RENAME_REQUEST_ID = 7;
const ENV_KEYS = [
  "LSP_SERVER_PORT",
  "LSP_TRACE_FILE",
  "FAKE_LSP_RECORD_FILE",
  "FAKE_LSP_ASK_CONFIG",
  "FAKE_LSP_RENAME_EDIT",
] as const;
const RELATIVE_PATHS = Object.keys(PHASE2_WORKSPACE_FILES);

let manager: LspServerManager;
let tempRoot: string;
let workspacePath: string;
let recordFile: string;
let wsPort: number;
let clients: TestClient[];
let savedEnv: Record<string, string | undefined>;
let originalExitListeners = process.listeners("exit");

function fileUri(relativePath: string): string {
  return pathToFileURL(path.join(workspacePath, relativePath)).href;
}

function readDiskText(relativePath: string): string {
  return readFileSync(path.join(workspacePath, relativePath), "utf8");
}

function readAllDiskTexts(): Record<string, string> {
  return Object.fromEntries(
    RELATIVE_PATHS.map((relativePath) => [
      relativePath,
      readDiskText(relativePath),
    ]),
  );
}

function didOpen(client: TestClient, relativePath: string) {
  send(client, {
    method: "textDocument/didOpen",
    params: {
      textDocument: {
        uri: fileUri(relativePath),
        languageId: "typescript",
        version: 1,
        text: readDiskText(relativePath),
      },
    },
  });
}

function didChangeToUnsavedText(client: TestClient, relativePath: string) {
  send(client, {
    method: "textDocument/didChange",
    params: {
      textDocument: { uri: fileUri(relativePath), version: 2 },
      contentChanges: [{ text: `${readDiskText(relativePath)}// unsaved\n` }],
    },
  });
}

async function connectWithOnlyBOpen(): Promise<TestClient> {
  await manager.start({ workspaceId: WORKSPACE_ID, workspacePath });
  const client = await connectClient(
    buildLspWsUrl(wsPort, WORKSPACE_ID, manager.epoch),
  );
  clients.push(client);
  send(client, {
    id: 0,
    method: "initialize",
    params: { processId: null, rootUri: null, capabilities: {} },
  });
  await waitForResponse(client, 0);
  send(client, { method: "initialized", params: {} });
  didOpen(client, "src/b.ts");
  return client;
}

async function renameHelperInB(client: TestClient) {
  send(client, {
    id: RENAME_REQUEST_ID,
    method: "textDocument/rename",
    params: {
      textDocument: { uri: fileUri("src/b.ts") },
      position: { line: 1, character: 16 },
      newName: "renamed",
    },
  });
  const response = await waitForResponse(client, RENAME_REQUEST_ID);
  const editResult = await waitForNotificationParams(
    client,
    LSP_EDIT_RESULT_NOTIFICATION,
  );
  return { response, editResult };
}

function expectRefusedWithoutDiskChanges(
  outcome: Awaited<ReturnType<typeof renameHelperInB>>,
  reasonPattern: RegExp,
) {
  expect(outcome.response.error?.code).toBe(-32803);
  expect(outcome.response.error?.message).toMatch(reasonPattern);
  expect(outcome.editResult).toMatchObject({ applied: false });
  expect(readAllDiskTexts()).toEqual(PHASE2_WORKSPACE_FILES);
  expect(recordedMethods(recordFile)).not.toContain(
    "workspace/didChangeWatchedFiles",
  );
}

beforeEach(async () => {
  originalExitListeners = process.listeners("exit");
  savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  tempRoot = realpathSync(mkdtempSync(path.join(tmpdir(), "editor-lsp-p2-")));
  workspacePath = path.join(tempRoot, "workspace");
  recordFile = path.join(tempRoot, "fake-lsp-record.jsonl");
  for (const [relativePath, content] of Object.entries(
    PHASE2_WORKSPACE_FILES,
  )) {
    const absolutePath = path.join(workspacePath, relativePath);
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, content);
  }
  process.env.LSP_SERVER_PORT = "0";
  process.env.FAKE_LSP_RECORD_FILE = recordFile;
  process.env.FAKE_LSP_RENAME_EDIT = "1";
  delete process.env.LSP_TRACE_FILE;
  delete process.env.FAKE_LSP_ASK_CONFIG;
  clients = [];
  manager = new LspServerManager({
    resolveServerCommand: () => ({
      command: process.execPath,
      args: [FIXTURE_SERVER_PATH],
    }),
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

describe("rename write-through", () => {
  it("writes all three files and replies with an empty edit", async () => {
    const client = await connectWithOnlyBOpen();

    const { response, editResult } = await renameHelperInB(client);

    const expectedUris = RELATIVE_PATHS.map(fileUri).sort();
    expect(response.result).toEqual({ changes: {} });
    expect(editResult).toMatchObject({ applied: true, createdUris: [] });
    expect(editResult.changedUris).toHaveLength(3);
    expect(editResult.changedUris).toEqual(
      expect.arrayContaining(expectedUris),
    );
    for (const [relativePath, original] of Object.entries(
      PHASE2_WORKSPACE_FILES,
    )) {
      expect(readDiskText(relativePath)).toBe(
        original.replaceAll("helper", "renamed"),
      );
    }
    const watched = await waitForRecordedMessage(
      recordFile,
      "workspace/didChangeWatchedFiles",
    );
    const watchedChanges = isLspRecord(watched.params)
      ? watched.params.changes
      : undefined;
    expect(watchedChanges).toHaveLength(3);
    expect(watchedChanges).toEqual(
      expect.arrayContaining(expectedUris.map((uri) => ({ uri, type: 2 }))),
    );
  });
});

describe("refuse", () => {
  it("refuses a rename touching a synced document with unsaved changes", async () => {
    const client = await connectWithOnlyBOpen();
    didChangeToUnsavedText(client, "src/b.ts");

    const outcome = await renameHelperInB(client);

    expectRefusedWithoutDiskChanges(outcome, /unsaved changes/);
  });

  it("refuses a rename touching a dirty tab whose document was closed", async () => {
    const client = await connectWithOnlyBOpen();
    didOpen(client, "src/a.ts");
    didChangeToUnsavedText(client, "src/a.ts");
    send(client, {
      method: LSP_DIRTY_DOCUMENTS_NOTIFICATION,
      params: { uris: [fileUri("src/a.ts")] },
    });
    send(client, {
      method: "textDocument/didClose",
      params: { textDocument: { uri: fileUri("src/a.ts") } },
    });

    const outcome = await renameHelperInB(client);

    expectRefusedWithoutDiskChanges(outcome, /src\/a\.ts has unsaved changes/);
    expect(recordedMethods(recordFile)).toContain("textDocument/didClose");
    expect(recordedMethods(recordFile)).not.toContain(
      LSP_DIRTY_DOCUMENTS_NOTIFICATION,
    );
  });

  it("refuses a rename whose edit deletes a file", async () => {
    process.env.FAKE_LSP_RENAME_EDIT = "delete";
    const client = await connectWithOnlyBOpen();

    const outcome = await renameHelperInB(client);

    expectRefusedWithoutDiskChanges(outcome, /file deletion is not supported/);
  });
});
