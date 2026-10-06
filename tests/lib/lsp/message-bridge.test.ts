// @vitest-environment node
// allow: SIZE_OK — Task 6 requires the complete bridge rule table in this one test file.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLspBridgeSession } from "@/lib/lsp/message-bridge";
import {
  LSP_PHASE1_CLIENT_NOTIFICATIONS,
  LSP_PHASE1_CLIENT_REQUESTS,
  LSP_PHASE1_DYNAMIC_METHODS,
  LSP_PHASE1_SERVER_CAPABILITIES,
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
  allowedServerCapabilities: LSP_PHASE1_SERVER_CAPABILITIES,
  allowedDynamicMethods: LSP_PHASE1_DYNAMIC_METHODS,
  allowedClientRequests: LSP_PHASE1_CLIENT_REQUESTS,
  allowedClientNotifications: LSP_PHASE1_CLIENT_NOTIFICATIONS,
};
let bridge: ReturnType<typeof createLspBridgeSession>;
beforeEach(() => {
  resolveRealCaseUri.mockClear();
  bridge = createLspBridgeSession(options);
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
  it.each([
    "textDocument/references",
    "workspace/executeCommand",
    "unknown/request",
  ])("C1b rejects %s with id 0 before URI resolution", (method) => {
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
  });
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
      LSP_PHASE1_SERVER_CAPABILITIES.map((key) => [key, { enabled: true }]),
    );
    const excluded = Object.fromEntries(
      [
        "referencesProvider",
        "renameProvider",
        "codeActionProvider",
        "documentSymbolProvider",
        "documentHighlightProvider",
        "foldingRangeProvider",
        "codeLensProvider",
        "diagnosticProvider",
        "executeCommandProvider",
      ].map((key) => [key, true]),
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
    const message = response({ capabilities: { renameProvider: true } });
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
        [key]: [allowed, { id: "drop", method: "textDocument/rename" }],
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
            [key]: [{ id: "drop", method: "textDocument/rename" }],
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
  it("S4 supplies workspace folders", () => {
    expect(bridge.fromServer(request("workspace/workspaceFolders"))).toEqual(
      toServer(response([folder])),
    );
  });
  it("S5 refuses workspace edits", () => {
    expect(
      bridge.fromServer(
        request("workspace/applyEdit", { edit: { changes: { [uri]: [] } } }),
      ),
    ).toEqual(
      toServer(
        response({
          applied: false,
          failureReason: "Workspace edits are not supported in Phase 1",
        }),
      ),
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
