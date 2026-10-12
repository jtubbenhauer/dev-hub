import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { vi } from "vitest";
import WebSocket from "ws";
import {
  isJsonRpcNotification,
  isJsonRpcResponse,
  isLspRecord,
  type JsonRpcResponse,
} from "@/lib/lsp/types";

export const FIXTURE_SERVER_PATH = path.resolve(
  "tests/fixtures/fake-lsp-server.mjs",
);

// The fake server's FAKE_LSP_RENAME_EDIT ranges point at every `helper` here.
export const PHASE2_WORKSPACE_FILES: Readonly<Record<string, string>> = {
  "src/a.ts":
    'import { helper } from "./b";\nexport const total = helper(1);\n',
  "src/b.ts":
    "export const answer = 42;\nexport function helper(value: number): number {\n  return value + answer;\n}\n",
  "src/refs.ts":
    'import { helper } from "./b";\nexport const one = helper(1);\nexport const two = helper(2);\n',
};

export type TestClient = {
  readonly socket: WebSocket;
  readonly messages: unknown[];
};

const WAIT_OPTIONS = { timeout: 3_000, interval: 10 } as const;

export async function connectClient(url: string): Promise<TestClient> {
  const socket = new WebSocket(url);
  const messages: unknown[] = [];
  socket.on("message", (data) => messages.push(JSON.parse(data.toString())));
  await new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });
  return { socket, messages };
}

export function send(client: TestClient, message: Record<string, unknown>) {
  client.socket.send(JSON.stringify({ jsonrpc: "2.0", ...message }));
}

export function waitForResponse(
  client: TestClient,
  id: number,
): Promise<JsonRpcResponse> {
  return vi.waitFor(() => {
    const response = client.messages.find(
      (message) => isJsonRpcResponse(message) && message.id === id,
    );
    if (!isJsonRpcResponse(response)) throw new Error(`No response ${id}`);
    return response;
  }, WAIT_OPTIONS);
}

export function waitForNotificationParams(
  client: TestClient,
  method: string,
): Promise<Record<string, unknown>> {
  return vi.waitFor(() => {
    const notification = client.messages.find(
      (message) => isJsonRpcNotification(message) && message.method === method,
    );
    if (!isJsonRpcNotification(notification))
      throw new Error(`No notification ${method}`);
    const params = notification.params;
    if (!isLspRecord(params)) throw new Error(`${method} without params`);
    return params;
  }, WAIT_OPTIONS);
}

export function readRecordedMessages(
  recordFile: string,
): Record<string, unknown>[] {
  if (!existsSync(recordFile)) return [];
  return readFileSync(recordFile, "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .flatMap((line) => {
      const parsed: unknown = JSON.parse(line);
      return isLspRecord(parsed) ? [parsed] : [];
    });
}

export function recordedMethods(recordFile: string): unknown[] {
  return readRecordedMessages(recordFile).map((message) => message.method);
}

export function waitForRecordedMessage(
  recordFile: string,
  method: string,
): Promise<Record<string, unknown>> {
  return vi.waitFor(() => {
    const found = readRecordedMessages(recordFile).find(
      (message) => message.method === method,
    );
    if (found === undefined) throw new Error(`${method} not recorded yet`);
    return found;
  }, WAIT_OPTIONS);
}
