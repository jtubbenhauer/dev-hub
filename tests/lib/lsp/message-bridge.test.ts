// @vitest-environment node
// allow: SIZE_OK — Task 6 requires the complete bridge rule table in this one test file.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLspBridgeSession } from "@/lib/lsp/message-bridge";
import type { ApplyWorkspaceEdit } from "@/lib/lsp/bridge-workspace-edits";
import {
  LSP_PHASE2_SERVER_CAPABILITIES,
  LSP_APPLY_EDIT_COMMAND,
  LSP_EDIT_RESULT_NOTIFICATION,
  LSP_DIRTY_DOCUMENTS_NOTIFICATION,
  type LspWorkspaceEditResult,
  type LspWorkspaceEdit,
  type LspSyncedDocument,
  type JsonRpcMessage,
  type JsonRpcId,
} from "@/lib/lsp/types";
import { VTSLS_SETTINGS } from "@/lib/lsp/vtsls-settings";

const root = "/Workspace/My App";
const rootUri = "file:///Workspace/My%20App";
const uri = `${rootUri}/src/Widget.tsx`;
const folder = { uri: rootUri, name: "My App" };
const notification = (method: string, params?: unknown): JsonRpcMessage => ({
  jsonrpc: "2.0",
  method,
  params,
});
const request = (
  method: string,
  params?: unknown,
  id: JsonRpcId = 0,
): JsonRpcMessage => ({ jsonrpc: "2.0", id, method, params });
const response = (
  result: unknown,
  id: JsonRpcId | null = 0,
): JsonRpcMessage => ({ jsonrpc: "2.0", id, result });
const toClient = (...messages: JsonRpcMessage[]) => ({
  toClient: messages,
  toServer: [],
});
const toServer = (...messages: JsonRpcMessage[]) => ({
  toClient: [],
  toServer: messages,
});
const resolveRealCaseUri = vi.fn((input: string): string | null =>
  input.toLowerCase() === uri.toLowerCase() ? uri : null,
);
const options = {
  workspaceRoot: root,
  resolveRealCaseUri,
  settings: VTSLS_SETTINGS,
  applyWorkspaceEdit: vi.fn<ApplyWorkspaceEdit>(),
};
let bridge: ReturnType<typeof createLspBridgeSession>;
beforeEach(() => {
  resolveRealCaseUri.mockClear();
  bridge = createLspBridgeSession(options);
});

describe("phase2", () => {
  const edit: LspWorkspaceEdit = { changes: { [uri]: [] } };
  const applied: LspWorkspaceEditResult = {
    applied: true,
    reason: null,
    changedUris: [uri, `${rootUri}/new.ts`],
    createdUris: [`${rootUri}/new.ts`],
  };
  const writer =
    vi.fn<
      (
        edit: LspWorkspaceEdit,
        synced: ReadonlyMap<string, LspSyncedDocument>,
        dirty: ReadonlySet<string>,
      ) => LspWorkspaceEditResult
    >();
  const watched = notification("workspace/didChangeWatchedFiles", {
    changes: [
      { uri: `${rootUri}/new.ts`, type: 1 },
      { uri, type: 2 },
    ],
  });
  const execute = (editId = "edit-1") =>
    request("workspace/executeCommand", {
      command: LSP_APPLY_EDIT_COMMAND,
      arguments: [editId],
    });
  beforeEach(() => {
    writer.mockReset().mockReturnValue(applied);
    bridge = createLspBridgeSession({
      ...options,
      applyWorkspaceEdit: writer,
    });
  });
  it("returns an empty edit and notifies when rename is applied", () => {
    bridge.fromClient(
      request("textDocument/rename", { textDocument: { uri } }),
    );
    const result = bridge.fromServer(response(edit));
    expect(result).toEqual({
      toClient: [
        response({ changes: {} }),
        notification(LSP_EDIT_RESULT_NOTIFICATION, applied),
      ],
      toServer: [watched],
    });
    expect(writer).toHaveBeenCalledWith(edit, new Map(), new Set());
  });
  it("returns RequestFailed and notifies when rename is refused", () => {
    const refused = {
      ...applied,
      applied: false,
      reason: "a.ts has unsaved changes — save it first",
      changedUris: [],
      createdUris: [],
    };
    writer.mockReturnValue(refused);
    bridge.fromClient(request("textDocument/rename"));
    const result = bridge.fromServer(response(edit));
    expect(result).toEqual(
      toClient(
        {
          jsonrpc: "2.0",
          id: 0,
          error: { code: -32803, message: refused.reason },
        },
        notification(LSP_EDIT_RESULT_NOTIFICATION, refused),
      ),
    );
  });
  it("keeps null results unchanged when rename has no edit", () => {
    bridge.fromClient(request("textDocument/rename"));
    const result = bridge.fromServer(response(null));
    expect(result).toEqual(toClient(response(null)));
    expect(writer).not.toHaveBeenCalled();
  });
  it("wraps code action edits without writing when listing actions", () => {
    const followUp = { title: "Next", command: "server.next" };
    const lazy = { title: "Lazy", data: 4 };
    bridge.fromClient(request("textDocument/codeAction"));
    const result = bridge.fromServer(
      response([{ title: "Fix", edit, command: followUp }, lazy]),
    );
    expect(result).toEqual(
      toClient(
        response([
          {
            title: "Fix",
            command: {
              title: "Fix",
              command: LSP_APPLY_EDIT_COMMAND,
              arguments: ["edit-1", followUp],
            },
          },
          lazy,
        ]),
      ),
    );
    expect(writer).not.toHaveBeenCalled();
  });
  it.each([LSP_APPLY_EDIT_COMMAND, "devhub.lsp.applyEdit"])(
    "unwraps %s when a resolved action contains a fresh edit",
    (command) => {
      const followUp = {
        title: "Next",
        command: "server.next",
        arguments: [1],
      };
      bridge.fromClient(request("codeAction/resolve"));
      const result = bridge.fromServer(
        response({
          title: "Fix",
          edit,
          command: { title: "Fix", command, arguments: ["old", followUp] },
        }),
      );
      expect(result).toEqual(
        toClient(
          response({
            title: "Fix",
            command: {
              title: "Fix",
              command: LSP_APPLY_EDIT_COMMAND,
              arguments: ["edit-1", followUp],
            },
          }),
        ),
      );
      expect(writer).not.toHaveBeenCalled();
    },
  );
  it("writes once without forwarding when a wrapped action is selected", () => {
    bridge.fromClient(request("textDocument/codeAction"));
    bridge.fromServer(response([{ title: "Fix", edit }]));
    const result = bridge.fromClient(execute());
    expect(result).toEqual({
      toClient: [response(applied)],
      toServer: [watched],
    });
    expect(writer).toHaveBeenCalledExactlyOnceWith(edit, new Map(), new Set());
  });
  it("expires consumed actions when selected twice", () => {
    bridge.fromClient(request("textDocument/codeAction"));
    bridge.fromServer(response([{ title: "Fix", edit }]));
    bridge.fromClient(execute());
    writer.mockClear();
    const result = bridge.fromClient(execute());
    expect(result).toEqual(
      toClient(
        response({
          applied: false,
          reason: "edit expired — run the action again",
          changedUris: [],
          createdUris: [],
        }),
      ),
    );
    expect(writer).not.toHaveBeenCalled();
  });
  it("returns expired when the edit id is unknown", () => {
    const result = bridge.fromClient(execute("unknown"));
    expect(result).toEqual(
      toClient(
        response({
          applied: false,
          reason: "edit expired — run the action again",
          changedUris: [],
          createdUris: [],
        }),
      ),
    );
    expect(writer).not.toHaveBeenCalled();
  });
  it("evicts the oldest action when the pending edit cap is exceeded", () => {
    bridge.fromClient(request("textDocument/codeAction"));
    bridge.fromServer(
      response(Array.from({ length: 201 }, () => ({ title: "Fix", edit }))),
    );
    const result = bridge.fromClient(execute("edit-1"));
    expect(result.toClient).toEqual([
      response({
        applied: false,
        reason: "edit expired — run the action again",
        changedUris: [],
        createdUris: [],
      }),
    ]);
    expect(writer).not.toHaveBeenCalled();
  });
  it("answers the server without exposing an edit when applyEdit arrives", () => {
    const result = bridge.fromServer(request("workspace/applyEdit", { edit }));
    expect(result).toEqual({
      toServer: [
        response({ applied: true, failureReason: undefined }),
        watched,
      ],
      toClient: [notification(LSP_EDIT_RESULT_NOTIFICATION, applied)],
    });
    expect(writer).toHaveBeenCalledExactlyOnceWith(edit, new Map(), new Set());
  });
  it("refuses malformed server edits before calling the writer", () => {
    const result = bridge.fromServer(
      request("workspace/applyEdit", { edit: { changes: { [uri]: [{}] } } }),
    );
    expect(result.toServer).toEqual([
      response({ applied: false, failureReason: "malformed edit" }),
    ]);
    expect(writer).not.toHaveBeenCalled();
  });
  it("tracks text in step when didChange contains sequential incremental changes", () => {
    bridge.fromClient(
      notification("textDocument/didOpen", {
        textDocument: { uri: uri.toLowerCase(), text: "abc", version: 1 },
      }),
    );
    bridge.fromClient(
      notification("textDocument/didChange", {
        textDocument: { uri, version: 2 },
        contentChanges: [
          {
            range: {
              start: { line: 0, character: 1 },
              end: { line: 0, character: 2 },
            },
            text: "XY",
          },
        ],
      }),
    );
    bridge.fromServer(request("workspace/applyEdit", { edit }));
    expect(writer).toHaveBeenCalledWith(
      edit,
      new Map([[uri, { version: 2, text: "aXYc" }]]),
      new Set(),
    );
  });
  it("replaces the real-case dirty set before the allowlist gate", () => {
    const result = bridge.fromClient(
      notification(LSP_DIRTY_DOCUMENTS_NOTIFICATION, {
        uris: [uri.toLowerCase(), "inmemory://model/1"],
      }),
    );
    bridge.fromServer(request("workspace/applyEdit", { edit }));
    expect(result).toEqual(toClient());
    expect(writer).toHaveBeenCalledWith(edit, new Map(), new Set([uri]));
    bridge.fromClient(
      notification(LSP_DIRTY_DOCUMENTS_NOTIFICATION, { uris: [] }),
    );
    bridge.fromServer(request("workspace/applyEdit", { edit }));
    expect(writer).toHaveBeenLastCalledWith(edit, new Map(), new Set());
  });
  it("retains dirty tabs when didClose removes the synced document", () => {
    bridge.fromClient(
      notification("textDocument/didOpen", {
        textDocument: { uri, version: 1, text: "abc" },
      }),
    );
    bridge.fromClient(
      notification("textDocument/didChange", {
        textDocument: { uri, version: 2 },
        contentChanges: [{ text: "dirty" }],
      }),
    );
    bridge.fromClient(
      notification(LSP_DIRTY_DOCUMENTS_NOTIFICATION, { uris: [uri] }),
    );
    bridge.fromClient(
      notification("textDocument/didClose", { textDocument: { uri } }),
    );
    bridge.fromClient(request("textDocument/rename"));
    bridge.fromServer(response(edit));
    expect(writer).toHaveBeenCalledWith(edit, new Map(), new Set([uri]));
  });
  it("passes dirty tabs to the writer when selecting a wrapped action", () => {
    bridge.fromClient(
      notification(LSP_DIRTY_DOCUMENTS_NOTIFICATION, { uris: [uri] }),
    );
    bridge.fromClient(request("textDocument/codeAction"));
    bridge.fromServer(response([{ title: "Fix", edit }]));
    bridge.fromClient(execute());
    expect(writer).toHaveBeenCalledWith(edit, new Map(), new Set([uri]));
  });
  it("strips the client-owned move command when initialize completes", () => {
    bridge.fromClient(request("initialize"));
    const result = bridge.fromServer(
      response({
        capabilities: {
          renameProvider: true,
          executeCommandProvider: {
            commands: ["_typescript.moveToFileRefactoring", "keep"],
          },
          diagnosticProvider: true,
        },
      }),
    );
    expect(result).toEqual(
      toClient(
        response({
          capabilities: {
            renameProvider: true,
            executeCommandProvider: { commands: ["keep"] },
          },
        }),
      ),
    );
  });
  it("allows references when the Phase 2 profile is selected", () => {
    const message = request("textDocument/references", {
      textDocument: { uri },
    });
    expect(bridge.fromClient(message)).toEqual(toServer(message));
  });
  it("allows dynamic rename registration when the Phase 2 profile is selected", () => {
    const message = request("client/registerCapability", {
      registrations: [{ id: "rename", method: "textDocument/rename" }],
    });
    expect(bridge.fromServer(message)).toEqual(toClient(message));
  });
});

describe("fromClient", () => {
  it.each([
    response(null),
    {
      jsonrpc: "2.0",
      id: 0,
      error: { code: -1, message: "failed" },
    } satisfies JsonRpcMessage,
  ])("C1 forwards responses before the method gate: %j", (message) => {
    expect(bridge.fromClient(message)).toEqual(toServer(message));
  });
  it.each(["unknown/request"])(
    "C1b rejects %s with id 0 before URI resolution",
    (method) => {
      const result = bridge.fromClient(
        request(method, { textDocument: { uri } }),
      );
      expect(result).toEqual(
        toClient({
          jsonrpc: "2.0",
          id: 0,
          error: {
            code: -32601,
            message: `Method not allowed by the dev-hub LSP bridge: ${method}`,
          },
        }),
      );
      expect(resolveRealCaseUri).not.toHaveBeenCalled();
    },
  );
  it.each([
    "workspace/didChangeWorkspaceFolders",
    "workspace/didChangeConfiguration",
  ])("C1b drops disallowed notification %s", (method) => {
    expect(bridge.fromClient(notification(method))).toEqual(toClient());
  });
  it("C2 anchors native initialize without mutating textDocument capabilities", () => {
    const capabilities = {
      workspace: { inlayHint: { refreshSupport: true } },
      textDocument: {
        publishDiagnostics: {},
        diagnostic: { dynamicRegistration: true },
      },
    };
    const message = request("initialize", {
      processId: null,
      rootUri: null,
      capabilities,
    });
    const original = structuredClone(message);
    const result = bridge.fromClient(message);
    expect(result).toEqual(
      toServer(
        request("initialize", {
          processId: null,
          rootUri,
          rootPath: root,
          workspaceFolders: [folder],
          capabilities: {
            ...capabilities,
            workspace: {
              ...capabilities.workspace,
              configuration: true,
              workspaceFolders: true,
              didChangeConfiguration: { dynamicRegistration: false },
            },
          },
        }),
      ),
    );
    expect(message).toEqual(original);
  });
  it("C2 supplies omitted initialize params", () => {
    expect(bridge.fromClient(request("initialize"))).toEqual(
      toServer(
        request("initialize", {
          rootUri,
          rootPath: root,
          workspaceFolders: [folder],
          capabilities: {
            workspace: {
              configuration: true,
              workspaceFolders: true,
              didChangeConfiguration: { dynamicRegistration: false },
            },
          },
        }),
      ),
    );
  });
  it("C3 sends configured settings after initialized", () => {
    const message = notification("initialized");
    expect(bridge.fromClient(message)).toEqual(
      toServer(
        message,
        notification("workspace/didChangeConfiguration", {
          settings: VTSLS_SETTINGS,
        }),
      ),
    );
  });
  it("C4 answers shutdown id 0 locally", () => {
    expect(bridge.fromClient(request("shutdown"))).toEqual(
      toClient(response(null)),
    );
  });
  it("C4 drops exit", () => {
    expect(bridge.fromClient(notification("exit"))).toEqual(toClient());
  });
  it.each([
    "textDocument/didOpen",
    "textDocument/didChange",
    "textDocument/didSave",
    "textDocument/didClose",
  ])("C5 rewrites %s with real-case URI and didOpen language", (method) => {
    const message = notification(method, {
      textDocument: {
        uri: uri.toLowerCase(),
        languageId: "typescript",
        version: 1,
        text: "",
      },
    });
    const original = structuredClone(message);
    expect(bridge.fromClient(message)).toEqual(
      toServer(
        notification(method, {
          textDocument: {
            uri,
            languageId:
              method === "textDocument/didOpen"
                ? "typescriptreact"
                : "typescript",
            version: 1,
            text: "",
          },
        }),
      ),
    );
    expect(message).toEqual(original);
  });
  it("C5 rewrites and tracks an in-scope request with id 0", () => {
    const message = request("textDocument/completion", {
      textDocument: { uri: uri.toLowerCase() },
    });
    expect(bridge.fromClient(message)).toEqual(
      toServer(request("textDocument/completion", { textDocument: { uri } })),
    );
    expect(
      bridge.fromServer(
        response([
          {
            label: "x",
            command: { command: "_typescript.onCompletionAccepted" },
          },
        ]),
      ),
    ).toEqual(toClient(response([{ label: "x" }])));
  });
  describe("out of scope", () => {
    it.each([
      null,
      "file:///outside/a.ts",
      `${rootUri}2/a.ts`,
      `${rootUri}/src/a.json`,
    ])(
      "C5 answers inmemory hover null when resolution yields %s",
      (resolved) => {
        resolveRealCaseUri.mockReturnValueOnce(resolved);
        expect(
          bridge.fromClient(
            request("textDocument/hover", {
              textDocument: { uri: "inmemory://model/3" },
            }),
          ),
        ).toEqual(toClient(response(null)));
      },
    );
    it("C5 drops inmemory didOpen", () => {
      expect(
        bridge.fromClient(
          notification("textDocument/didOpen", {
            textDocument: { uri: "inmemory://model/3" },
          }),
        ),
      ).toEqual(toClient());
    });
  });
  it.each([
    notification("$/cancelRequest", { id: 0 }),
    request("inlayHint/resolve", { label: "x" }),
  ])("C6 forwards other allowed messages: %j", (message) => {
    expect(bridge.fromClient(message)).toEqual(toServer(message));
  });
});

describe("fromServer", () => {
  it("S1 trims initialize capabilities using the pending id 0 then deletes it", () => {
    bridge.fromClient(request("initialize"));
    const allowed = Object.fromEntries(
      LSP_PHASE2_SERVER_CAPABILITIES.map((key) => [key, { enabled: true }]),
    );
    const excluded = Object.fromEntries(
      ["diagnosticProvider", "workspaceSymbolProvider"].map((key) => [
        key,
        true,
      ]),
    );
    const message = response({
      capabilities: { ...allowed, ...excluded },
      serverInfo: { name: "vtsls" },
    });
    const original = structuredClone(message);
    expect(bridge.fromServer(message)).toEqual(
      toClient(
        response({ capabilities: allowed, serverInfo: { name: "vtsls" } }),
      ),
    );
    expect(message).toEqual(original);
    expect(bridge.fromServer(message)).toEqual(toClient(message));
  });
  it.each(["array", "items", "resolve"])(
    "S1 strips internal completion commands in %s responses without mutating input",
    (shape) => {
      const items = [
        {
          label: "internal",
          command: { command: "_typescript.onCompletionAccepted" },
        },
        {
          label: "public",
          command: { command: "editor.action.triggerSuggest" },
        },
        { label: "plain" },
      ];
      const expectedItems = [{ label: "internal" }, items[1], items[2]];
      bridge.fromClient(
        request(
          shape === "resolve"
            ? "completionItem/resolve"
            : "textDocument/completion",
        ),
      );
      const message = response(
        shape === "array"
          ? items
          : shape === "items"
            ? { items, isIncomplete: true }
            : items[0],
      );
      const original = structuredClone(message);
      const expected =
        shape === "array"
          ? expectedItems
          : shape === "items"
            ? { items: expectedItems, isIncomplete: true }
            : expectedItems[0];
      expect(bridge.fromServer(message)).toEqual(toClient(response(expected)));
      expect(message).toEqual(original);
    },
  );
  it.each(["array", "items", "resolve"])(
    "S1 strips _vtsls completion commands in %s responses and keeps other commands",
    (shape) => {
      const items = [
        {
          label: "vtsls-internal",
          command: { command: "_vtsls.completionCacheCommand" },
        },
        {
          label: "public",
          command: { command: "editor.action.triggerParameterHints" },
        },
      ];
      const expectedItems = [{ label: "vtsls-internal" }, items[1]];
      bridge.fromClient(
        request(
          shape === "resolve"
            ? "completionItem/resolve"
            : "textDocument/completion",
        ),
      );
      const message = response(
        shape === "array"
          ? items
          : shape === "items"
            ? { items, isIncomplete: false }
            : items[0],
      );
      const original = structuredClone(message);
      const expected =
        shape === "array"
          ? expectedItems
          : shape === "items"
            ? { items: expectedItems, isIncomplete: false }
            : expectedItems[0];
      expect(bridge.fromServer(message)).toEqual(toClient(response(expected)));
      expect(message).toEqual(original);
    },
  );
  it("S1 retains other commands on completionItem/resolve", () => {
    bridge.fromClient(request("completionItem/resolve"));
    const message = response({
      label: "public",
      command: { command: "public.command" },
    });
    expect(bridge.fromServer(message)).toEqual(toClient(message));
  });
  it.each([
    response(null, null),
    response({ uri }),
    {
      jsonrpc: "2.0",
      id: 0,
      error: { code: -1, message: "failed" },
    } satisfies JsonRpcMessage,
  ])("S1 forwards unknown or error responses unchanged: %j", (message) => {
    expect(bridge.fromServer(message)).toEqual(toClient(message));
  });
  it("S1 clears pending requests after exceeding 10,000", () => {
    for (let id = 0; id <= 10000; id += 1)
      bridge.fromClient(request("initialize", undefined, id));
    const message = response({ capabilities: { diagnosticProvider: true } });
    expect(bridge.fromServer(message)).toEqual(toClient(message));
  });
  it.each(["client/registerCapability", "client/unregisterCapability"])(
    "S2 filters %s with the LSP field spelling",
    (method) => {
      const key =
        method === "client/registerCapability"
          ? "registrations"
          : "unregisterations";
      const allowed = {
        id: "keep",
        method: "textDocument/hover",
        registerOptions: { documentSelector: [] },
      };
      const message = request(method, {
        [key]: [allowed, { id: "drop", method: "workspace/symbol" }],
      });
      const original = structuredClone(message);
      expect(bridge.fromServer(message)).toEqual(
        toClient(request(method, { [key]: [allowed] })),
      );
      expect(message).toEqual(original);
    },
  );
  it.each(["client/registerCapability", "client/unregisterCapability"])(
    "S2 acknowledges %s locally when all entries are disallowed",
    (method) => {
      const key =
        method === "client/registerCapability"
          ? "registrations"
          : "unregisterations";
      expect(
        bridge.fromServer(
          request(method, {
            [key]: [{ id: "drop", method: "workspace/symbol" }],
          }),
        ),
      ).toEqual(toServer(response(null)));
    },
  );
  it("S3 returns ordered whole, dotted, unknown settings sections", () => {
    const message = request("workspace/configuration", {
      items: [
        {},
        { section: "" },
        { section: "typescript.inlayHints.parameterNames.enabled" },
        { section: "missing" },
      ],
    });
    expect(bridge.fromServer(message)).toEqual(
      toServer(response([VTSLS_SETTINGS, VTSLS_SETTINGS, "literals", null])),
    );
  });
  it("S3b delivers the 50-entry completion cap to vtsls on both paths", () => {
    const expectedCompletion = {
      enableServerSideFuzzyMatch: true,
      entriesLimit: 50,
    };
    const message = request("workspace/configuration", {
      items: [{ section: "vtsls.experimental.completion" }],
    });
    expect(bridge.fromServer(message)).toEqual(
      toServer(response([expectedCompletion])),
    );
    const initialized = notification("initialized");
    expect(bridge.fromClient(initialized)).toEqual(
      toServer(
        initialized,
        notification("workspace/didChangeConfiguration", {
          settings: expect.objectContaining({
            vtsls: expect.objectContaining({
              experimental: { completion: expectedCompletion },
            }),
          }),
        }),
      ),
    );
  });
  it("S4 supplies workspace folders", () => {
    expect(bridge.fromServer(request("workspace/workspaceFolders"))).toEqual(
      toServer(response([folder])),
    );
  });
  it("S6 answers other server requests null", () => {
    expect(bridge.fromServer(request("window/showMessageRequest"))).toEqual(
      toServer(response(null)),
    );
  });
  it("S7 passes diagnostics without rewriting URIs", () => {
    const message = notification("textDocument/publishDiagnostics", {
      uri,
      diagnostics: [],
    });
    expect(bridge.fromServer(message)).toEqual(toClient(message));
    expect(resolveRealCaseUri).not.toHaveBeenCalled();
  });
  it.each(["window/logMessage", "$/progress", "custom/notification"])(
    "S7 drops other notifications: %s",
    (method) => {
      expect(bridge.fromServer(notification(method))).toEqual(toClient());
    },
  );
});
