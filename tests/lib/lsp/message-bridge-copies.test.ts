// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLspBridgeSession } from "@/lib/lsp/message-bridge";
import { record } from "@/lib/lsp/bridge-protocol";
import type { ApplyWorkspaceEdit } from "@/lib/lsp/bridge-workspace-edits";
import type { JsonRpcMessage } from "@/lib/lsp/types";
import { VTSLS_SETTINGS } from "@/lib/lsp/vtsls-settings";
import {
  edit,
  internalCompletion,
  lowerUri,
  mutatingCases,
  notification,
  request,
  response,
  uri,
} from "./message-bridge-copies-cases";

const root = "/Workspace/My App";
const paramsOf = (message: JsonRpcMessage | undefined) =>
  record(record(message).params);
const resultOf = (message: JsonRpcMessage | undefined) =>
  record(record(message).result);

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

const writer = vi.fn<ApplyWorkspaceEdit>();
let bridge: ReturnType<typeof createLspBridgeSession>;
beforeEach(() => {
  writer.mockReset().mockReturnValue({
    applied: true,
    reason: null,
    changedUris: [uri],
    createdUris: [],
  });
  bridge = createLspBridgeSession({
    workspaceRoot: root,
    resolveRealCaseUri: (input) =>
      input.toLowerCase() === lowerUri ? uri : null,
    settings: VTSLS_SETTINGS,
    applyWorkspaceEdit: writer,
  });
});
afterEach(() => vi.restoreAllMocks());

describe("mutating branches", () => {
  it.each(mutatingCases)(
    "leaves the caller's message untouched when $name",
    ({ direction, pendingMethod, message }) => {
      if (pendingMethod !== undefined)
        bridge.fromClient(request(pendingMethod));
      const snapshot = structuredClone(message);
      deepFreeze(message);
      bridge[direction](message);
      expect(message).toEqual(snapshot);
    },
  );
});

describe("pass-through branches", () => {
  it("forwards client responses as the same object", () => {
    const message = response({ applied: true }, 7);
    expect(bridge.fromClient(message).toServer[0]).toBe(message);
  });
  it("forwards didChange content changes without copying them", () => {
    const cloneSpy = vi.spyOn(globalThis, "structuredClone");
    const contentChanges = [{ text: "x".repeat(1_000) }];
    const output = bridge.fromClient(
      notification("textDocument/didChange", {
        textDocument: { uri, version: 2 },
        contentChanges,
      }),
    );
    expect(paramsOf(output.toServer[0]).contentChanges).toBe(contentChanges);
    expect(cloneSpy).not.toHaveBeenCalled();
  });
  it("forwards a semantic tokens response with the same data array", () => {
    bridge.fromClient(
      request("textDocument/semanticTokens/full", { textDocument: { uri } }),
    );
    const cloneSpy = vi.spyOn(globalThis, "structuredClone");
    const data = [0, 1, 2, 3, 4];
    const message = response({ resultId: "1", data });
    const output = bridge.fromServer(message);
    expect(output.toClient[0]).toBe(message);
    expect(resultOf(output.toClient[0]).data).toBe(data);
    expect(cloneSpy).not.toHaveBeenCalled();
  });
  it("forwards publishDiagnostics as the same object", () => {
    const cloneSpy = vi.spyOn(globalThis, "structuredClone");
    const message = notification("textDocument/publishDiagnostics", {
      uri,
      diagnostics: [{ message: "bad" }],
    });
    expect(bridge.fromServer(message).toClient[0]).toBe(message);
    expect(cloneSpy).not.toHaveBeenCalled();
  });
  it("keeps completion items without internal commands as the same objects", () => {
    bridge.fromClient(request("textDocument/completion"));
    const cloneSpy = vi.spyOn(globalThis, "structuredClone");
    const plain = { label: "plain", data: { index: 1 } };
    const output = bridge.fromServer(
      response({ isIncomplete: false, items: [internalCompletion, plain] }),
    );
    const items = resultOf(output.toClient[0]).items;
    expect(Array.isArray(items) && items[1]).toBe(plain);
    expect(cloneSpy).not.toHaveBeenCalled();
  });
  it("keeps code actions without edits as the same objects", () => {
    bridge.fromClient(request("textDocument/codeAction"));
    const lazy = { title: "Lazy", data: { id: 1 } };
    const output = bridge.fromServer(response([{ title: "Fix", edit }, lazy]));
    const result = record(output.toClient[0]).result;
    expect(Array.isArray(result) && result[1]).toBe(lazy);
  });
});
