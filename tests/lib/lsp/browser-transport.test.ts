import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  connectLspBrowserTransport,
  type LspBrowserTransport,
  type LspBrowserTransportOptions,
  type LspTransportMessage,
} from "@/lib/lsp/client/browser-transport";

const WORKSPACE_ROOT = "/w";
const TRANSPORT_URL = "ws://127.0.0.1:7601/?workspaceId=ws-1&epoch=1";
const A_URI = "file:///w/src/a.ts";

class FakeWebSocket extends EventTarget {
  static instances: FakeWebSocket[] = [];
  readonly send = vi.fn<(data: string) => void>();
  readonly close = vi.fn<(code?: number, reason?: string) => void>();

  constructor(readonly url: string) {
    super();
    FakeWebSocket.instances.push(this);
  }

  emitOpen() {
    this.dispatchEvent(new Event("open"));
  }

  emitError() {
    this.dispatchEvent(new Event("error"));
  }

  emitMessage(payload: unknown) {
    this.emitRawMessage(JSON.stringify(payload));
  }

  emitRawMessage(data: string) {
    this.dispatchEvent(new MessageEvent("message", { data }));
  }

  emitClose(code: number, reason: string) {
    this.dispatchEvent(new CloseEvent("close", { code, reason }));
  }

  sentMessages(): unknown[] {
    return this.send.mock.calls.map(([data]) => JSON.parse(data));
  }
}

// the fake implements only the WebSocket members the transport touches
const FakeWebSocketImpl = FakeWebSocket as unknown as typeof WebSocket;

function latestSocket(): FakeWebSocket {
  const socket = FakeWebSocket.instances.at(-1);
  if (!socket) throw new Error("no FakeWebSocket was constructed");
  return socket;
}

function startConnecting(overrides: Partial<LspBrowserTransportOptions> = {}) {
  const onUnexpectedClose = vi.fn<(code: number, reason: string) => void>();
  const normalizeIncomingUri = vi.fn(
    (uri: string) => `normalized:${uri.toLowerCase()}`,
  );
  const pendingTransport = connectLspBrowserTransport({
    url: TRANSPORT_URL,
    workspaceRoot: WORKSPACE_ROOT,
    resolveDefinitionTargets: async (result) => result,
    resolveDocumentUri: (sentUri) => sentUri,
    normalizeIncomingUri,
    onUnexpectedClose,
    WebSocketImpl: FakeWebSocketImpl,
    ...overrides,
  });
  return {
    pendingTransport,
    socket: latestSocket(),
    onUnexpectedClose,
    normalizeIncomingUri,
  };
}

async function connectOpenTransport(
  overrides: Partial<LspBrowserTransportOptions> = {},
) {
  const connection = startConnecting(overrides);
  connection.socket.emitOpen();
  const transport = await connection.pendingTransport;
  return { ...connection, transport };
}

function collectMessages(transport: LspBrowserTransport) {
  const received: LspTransportMessage[] = [];
  transport.setListener((message) => received.push(message));
  return received;
}

function flushAsyncWork() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function didOpen(uri: string): LspTransportMessage {
  return {
    jsonrpc: "2.0",
    method: "textDocument/didOpen",
    params: {
      textDocument: { uri, languageId: "typescript", version: 1, text: "" },
    },
  };
}

function didChange(uri: string): LspTransportMessage {
  return {
    jsonrpc: "2.0",
    method: "textDocument/didChange",
    params: { textDocument: { uri, version: 2 }, contentChanges: [] },
  };
}

function didClose(uri: string): LspTransportMessage {
  return {
    jsonrpc: "2.0",
    method: "textDocument/didClose",
    params: { textDocument: { uri } },
  };
}

function documentRequest(
  id: number,
  method: string,
  uri: string,
): LspTransportMessage {
  return {
    jsonrpc: "2.0",
    id,
    method,
    params: { textDocument: { uri }, position: { line: 0, character: 0 } },
  };
}

function publishDiagnostics(uri: string): LspTransportMessage {
  return {
    jsonrpc: "2.0",
    method: "textDocument/publishDiagnostics",
    params: { uri, diagnostics: [] },
  };
}

function readProperty(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  return Object.entries(value).find(([entryKey]) => entryKey === key)?.[1];
}

function sentDocumentUris(socket: FakeWebSocket): unknown[] {
  return socket
    .sentMessages()
    .map((message) =>
      readProperty(
        readProperty(readProperty(message, "params"), "textDocument"),
        "uri",
      ),
    );
}

beforeEach(() => {
  FakeWebSocket.instances = [];
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("connectLspBrowserTransport handshake", () => {
  it("resolves an open transport once the socket opens", async () => {
    const { transport, socket } = await connectOpenTransport();

    expect(socket.url).toBe(TRANSPORT_URL);
    expect(transport.state.value).toEqual({ state: "open" });
    expect(transport.toString()).toBe(`devhub-lsp-transport(${TRANSPORT_URL})`);
  });

  it("rejects and closes the socket when open times out", async () => {
    vi.useFakeTimers();
    const { pendingTransport, socket } = startConnecting({ openTimeoutMs: 50 });
    const rejection = expect(pendingTransport).rejects.toThrow(/timed out/);

    vi.advanceTimersByTime(50);

    await rejection;
    expect(socket.close).toHaveBeenCalledTimes(1);
  });

  it("rejects when the socket closes before open", async () => {
    const { pendingTransport, socket, onUnexpectedClose } = startConnecting();

    socket.emitClose(4001, "busy");

    await expect(pendingTransport).rejects.toThrow(/4001: busy/);
    expect(onUnexpectedClose).not.toHaveBeenCalled();
  });

  it("rejects when the socket errors before open", async () => {
    const { pendingTransport, socket } = startConnecting();

    socket.emitError();

    await expect(pendingTransport).rejects.toThrow(/error before open/);
    expect(socket.close).toHaveBeenCalledTimes(1);
  });
});

describe("incoming delivery", () => {
  it("queues messages received before a listener and flushes them in order", async () => {
    const { transport, socket } = await connectOpenTransport();
    const logMessage = {
      jsonrpc: "2.0",
      method: "window/logMessage",
      params: { type: 3, message: "hello" },
    };
    const configurationRequest = {
      jsonrpc: "2.0",
      id: 0,
      method: "workspace/configuration",
      params: { items: [] },
    };
    socket.emitMessage(logMessage);
    socket.emitMessage(configurationRequest);
    socket.emitMessage(publishDiagnostics("file:///w/src/never.ts"));
    await flushAsyncWork();

    const received = collectMessages(transport);

    expect(received.map((message) => message.method)).toEqual([
      "window/logMessage",
      "workspace/configuration",
      "textDocument/publishDiagnostics",
    ]);
  });

  it("ignores unparsable frames with a warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { transport, socket } = await connectOpenTransport();
    const received = collectMessages(transport);

    socket.emitRawMessage("{not json");
    await flushAsyncWork();

    expect(received).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  it("delivers a non-definition response unchanged and forgets its id 0", async () => {
    const { transport, socket } = await connectOpenTransport();
    const received = collectMessages(transport);
    await transport.send(documentRequest(0, "textDocument/hover", A_URI));
    const hoverResponse = { jsonrpc: "2.0", id: 0, result: { contents: "x" } };

    socket.emitMessage(hoverResponse);
    await flushAsyncWork();
    transport.detach();
    await flushAsyncWork();

    expect(received).toEqual([hoverResponse]);
  });
});

describe("outgoing scope filter", () => {
  it("does not send a didOpen whose document is outside the workspace", async () => {
    const { transport, socket } = await connectOpenTransport({
      resolveDocumentUri: () => "file:///elsewhere/x.ts",
    });

    await transport.send(didOpen("file:///elsewhere/x.ts"));

    expect(socket.send).not.toHaveBeenCalled();
  });

  it("answers an out-of-scope hover with null in a microtask without sending it", async () => {
    const { transport, socket } = await connectOpenTransport({
      resolveDocumentUri: () => "file:///elsewhere/x.ts",
    });
    const received = collectMessages(transport);

    const sendPromise = transport.send(
      documentRequest(7, "textDocument/hover", "file:///elsewhere/x.ts"),
    );
    const receivedSynchronously = [...received];
    await sendPromise;
    await flushAsyncWork();

    expect(receivedSynchronously).toEqual([]);
    expect(received).toEqual([{ jsonrpc: "2.0", id: 7, result: null }]);
    expect(socket.send).not.toHaveBeenCalled();
  });

  it("treats a document whose resolver returns null as out of scope", async () => {
    const { transport, socket } = await connectOpenTransport({
      resolveDocumentUri: () => null,
    });
    const received = collectMessages(transport);

    await transport.send(didOpen("inmemory://model/1"));
    await transport.send(
      documentRequest(0, "textDocument/hover", "inmemory://model/1"),
    );
    await flushAsyncWork();

    expect(socket.send).not.toHaveBeenCalled();
    expect(received).toEqual([{ jsonrpc: "2.0", id: 0, result: null }]);
  });

  it("sends an in-scope request as JSON with the full document URI", async () => {
    const fullUri = "file:///w/src/Components/Widget.ts";
    const { transport, socket } = await connectOpenTransport({
      resolveDocumentUri: () => fullUri,
    });
    const sentUri = "file:///w/src/components/widget.ts";

    await transport.send(documentRequest(3, "textDocument/hover", sentUri));

    expect(socket.sentMessages()).toEqual([
      documentRequest(3, "textDocument/hover", fullUri),
    ]);
  });

  it("never throws from send when the resolver throws", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { transport, socket } = await connectOpenTransport({
      resolveDocumentUri: () => {
        throw new Error("resolver exploded");
      },
    });

    await expect(transport.send(didOpen(A_URI))).resolves.toBeUndefined();
    expect(socket.send).not.toHaveBeenCalled();
  });
});

describe("non-document messages", () => {
  it("sends initialize with id 0 unchanged and does not answer it locally", async () => {
    const { transport, socket } = await connectOpenTransport({
      resolveDocumentUri: () => null,
    });
    const received = collectMessages(transport);
    const initialize: LspTransportMessage = {
      jsonrpc: "2.0",
      id: 0,
      method: "initialize",
      params: { processId: null, rootUri: null, capabilities: {} },
    };

    await transport.send(initialize);
    await flushAsyncWork();

    expect(socket.sentMessages()).toEqual([initialize]);
    expect(received).toEqual([]);
  });

  it("sends the initialized notification and a client response unchanged", async () => {
    const { transport, socket } = await connectOpenTransport({
      resolveDocumentUri: () => null,
    });
    const initialized: LspTransportMessage = {
      jsonrpc: "2.0",
      method: "initialized",
      params: {},
    };
    const configurationResponse: LspTransportMessage = {
      jsonrpc: "2.0",
      id: 0,
      result: [{ typescript: {} }],
    };

    await transport.send(initialized);
    await transport.send(configurationResponse);

    expect(socket.sentMessages()).toEqual([initialized, configurationResponse]);
  });
});

describe("document URI mapping", () => {
  it("keeps literal-escape names apart in both directions", async () => {
    const literalEscapeSent = "file:///w/src/my%20file.ts";
    const literalEscapeFull = "file:///w/src/my%2520file.ts";
    const spacedSent = "file:///w/src/my file.ts";
    const spacedFull = "file:///w/src/my%20file.ts";
    const fullBySent = new Map([
      [literalEscapeSent, literalEscapeFull],
      [spacedSent, spacedFull],
    ]);
    const { transport, socket } = await connectOpenTransport({
      resolveDocumentUri: (sentUri) => fullBySent.get(sentUri) ?? null,
    });
    const received = collectMessages(transport);

    await transport.send(didOpen(literalEscapeSent));
    await transport.send(didOpen(spacedSent));
    socket.emitMessage(publishDiagnostics(literalEscapeFull));
    socket.emitMessage(publishDiagnostics(spacedFull));
    await flushAsyncWork();

    expect(sentDocumentUris(socket)).toEqual([literalEscapeFull, spacedFull]);
    expect(received.map((message) => message.params)).toEqual([
      { uri: literalEscapeSent, diagnostics: [] },
      { uri: spacedSent, diagnostics: [] },
    ]);
  });

  it("sends a literal percent name with its fully encoded URI", async () => {
    const sentUri = "file:///w/src/100%.ts";
    const fullUri = "file:///w/src/100%25.ts";
    const { transport, socket } = await connectOpenTransport({
      resolveDocumentUri: (uri) => (uri === sentUri ? fullUri : null),
    });
    const received = collectMessages(transport);

    await transport.send(didOpen(sentUri));
    socket.emitMessage(publishDiagnostics(fullUri));
    await flushAsyncWork();

    expect(sentDocumentUris(socket)).toEqual([fullUri]);
    expect(received[0]?.params).toEqual({ uri: sentUri, diagnostics: [] });
  });

  it("sends didClose with the stored URI after the model is disposed and then forgets it", async () => {
    const fullBySent = new Map([[A_URI, "file:///w/src/A.ts"]]);
    const { transport, socket } = await connectOpenTransport({
      resolveDocumentUri: (sentUri) => fullBySent.get(sentUri) ?? null,
    });
    await transport.send(didOpen(A_URI));
    fullBySent.clear();

    await transport.send(didClose(A_URI));
    await transport.send(didChange(A_URI));

    expect(sentDocumentUris(socket)).toEqual([
      "file:///w/src/A.ts",
      "file:///w/src/A.ts",
    ]);
    expect(socket.sentMessages()[1]).toMatchObject({
      method: "textDocument/didClose",
    });
    expect(transport.getTrackedDocumentMapSizes()).toEqual({
      documentUris: 0,
      sentByPath: 0,
    });
  });
});

describe("definition hook", () => {
  it("delivers the resolver's value for a definition response with id 0", async () => {
    const serverResult = [
      { uri: "file:///w/src/b.ts", range: { start: {}, end: {} } },
    ];
    const resolvedResult = [
      { targetUri: "file:///w/src/B.ts", targetRange: { start: {}, end: {} } },
    ];
    const resolveDefinitionTargets = vi.fn(async () => resolvedResult);
    const { transport, socket, normalizeIncomingUri } =
      await connectOpenTransport({ resolveDefinitionTargets });
    const received = collectMessages(transport);
    await transport.send(documentRequest(0, "textDocument/definition", A_URI));

    socket.emitMessage({ jsonrpc: "2.0", id: 0, result: serverResult });
    await flushAsyncWork();

    expect(resolveDefinitionTargets).toHaveBeenCalledWith(serverResult);
    expect(normalizeIncomingUri).toHaveBeenCalledWith("file:///w/src/B.ts");
    expect(received).toEqual([
      {
        jsonrpc: "2.0",
        id: 0,
        result: [
          {
            targetUri: "normalized:file:///w/src/b.ts",
            targetRange: { start: {}, end: {} },
          },
        ],
      },
    ]);
  });

  it("rewrites opened targets to the sent URI and never-opened targets via normalizeIncomingUri", async () => {
    const sentWidgetUri = "file:///w/src/components/widget.ts";
    const fullWidgetUri = "file:///w/src/Components/Widget.ts";
    const { transport, socket, normalizeIncomingUri } =
      await connectOpenTransport({
        resolveDocumentUri: (uri) =>
          uri === sentWidgetUri ? fullWidgetUri : uri,
      });
    const received = collectMessages(transport);
    await transport.send(didOpen(sentWidgetUri));
    await transport.send(
      documentRequest(4, "textDocument/typeDefinition", sentWidgetUri),
    );

    socket.emitMessage({
      jsonrpc: "2.0",
      id: 4,
      result: [{ uri: fullWidgetUri }, { uri: "file:///w/src/Never.ts" }],
    });
    await flushAsyncWork();

    expect(normalizeIncomingUri).toHaveBeenCalledTimes(1);
    expect(received[0]?.result).toEqual([
      { uri: sentWidgetUri },
      { uri: "normalized:file:///w/src/never.ts" },
    ]);
  });

  it("delivers null when the definition resolver throws", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { transport, socket } = await connectOpenTransport({
      resolveDefinitionTargets: async () => {
        throw new Error("prefetch failed");
      },
    });
    const received = collectMessages(transport);
    await transport.send(
      documentRequest(2, "textDocument/implementation", A_URI),
    );

    socket.emitMessage({ jsonrpc: "2.0", id: 2, result: [{ uri: A_URI }] });
    await flushAsyncWork();

    expect(received).toEqual([{ jsonrpc: "2.0", id: 2, result: null }]);
  });

  it("answers only once when detached while the definition resolver is pending", async () => {
    let finishResolution: (value: unknown) => void = () => {};
    const { transport, socket } = await connectOpenTransport({
      resolveDefinitionTargets: () =>
        new Promise((resolve) => {
          finishResolution = resolve;
        }),
    });
    const received = collectMessages(transport);
    await transport.send(documentRequest(0, "textDocument/definition", A_URI));
    socket.emitMessage({ jsonrpc: "2.0", id: 0, result: [{ uri: A_URI }] });
    await flushAsyncWork();

    transport.detach();
    finishResolution([{ uri: A_URI }]);
    await flushAsyncWork();

    expect(received).toEqual([{ jsonrpc: "2.0", id: 0, result: null }]);
  });
});

describe("detached", () => {
  async function openThreeDocuments(transport: LspBrowserTransport) {
    await transport.send(didOpen("file:///w/src/a.ts"));
    await transport.send(didOpen("file:///w/src/b.ts"));
    await transport.send(didOpen("file:///w/src/c.ts"));
  }

  it("answers the pending id 0 request with null, clears both maps and closes the socket", async () => {
    const { transport, socket, onUnexpectedClose } =
      await connectOpenTransport();
    const received = collectMessages(transport);
    await openThreeDocuments(transport);
    await transport.send(documentRequest(0, "textDocument/hover", A_URI));
    expect(transport.getTrackedDocumentMapSizes()).toEqual({
      documentUris: 3,
      sentByPath: 3,
    });

    transport.detach();
    await flushAsyncWork();

    expect(received).toEqual([{ jsonrpc: "2.0", id: 0, result: null }]);
    expect(transport.getTrackedDocumentMapSizes()).toEqual({
      documentUris: 0,
      sentByPath: 0,
    });
    expect(socket.close).toHaveBeenCalledWith(1000, "client-detached");
    expect(transport.state.value).toEqual({
      state: "closed",
      error: undefined,
    });
    socket.emitClose(1000, "client-detached");
    expect(onUnexpectedClose).not.toHaveBeenCalled();
  });

  it("answers new requests with null, sends nothing and never throws", async () => {
    const { transport, socket } = await connectOpenTransport();
    const received = collectMessages(transport);
    transport.detach();

    await transport.send(documentRequest(5, "textDocument/hover", A_URI));
    await transport.send(didOpen(A_URI));
    await transport.send({ jsonrpc: "2.0", method: "initialized", params: {} });
    await flushAsyncWork();

    expect(received).toEqual([{ jsonrpc: "2.0", id: 5, result: null }]);
    expect(socket.send).not.toHaveBeenCalled();
    expect(transport.getTrackedDocumentMapSizes()).toEqual({
      documentUris: 0,
      sentByPath: 0,
    });
  });

  it("is idempotent and notifies state listeners once", async () => {
    const { transport, socket } = await connectOpenTransport();
    const stateListener = vi.fn();
    const subscription = transport.state.onChange(stateListener);

    transport.detach();
    transport.detach();
    subscription.dispose();

    expect(socket.close).toHaveBeenCalledTimes(1);
    expect(stateListener).toHaveBeenCalledTimes(1);
    expect(stateListener).toHaveBeenCalledWith({
      state: "closed",
      error: undefined,
    });
  });

  it("leaves every detached transport's maps empty across five connect cycles", async () => {
    const detachedTransports: LspBrowserTransport[] = [];
    for (let cycle = 0; cycle < 5; cycle += 1) {
      const { transport } = await connectOpenTransport();
      await openThreeDocuments(transport);
      transport.detach();
      detachedTransports.push(transport);
    }

    expect(
      detachedTransports.map((transport) =>
        transport.getTrackedDocumentMapSizes(),
      ),
    ).toEqual(
      Array.from({ length: 5 }, () => ({ documentUris: 0, sentByPath: 0 })),
    );
  });
});

describe("unexpected close", () => {
  it("reports once, answers pending requests with null and clears both maps", async () => {
    const { transport, socket, onUnexpectedClose } =
      await connectOpenTransport();
    const received = collectMessages(transport);
    await transport.send(didOpen(A_URI));
    await transport.send(documentRequest(0, "textDocument/hover", A_URI));
    await transport.send(documentRequest(1, "textDocument/definition", A_URI));

    socket.emitClose(4004, "server exited");
    socket.emitClose(4004, "server exited");
    await flushAsyncWork();

    expect(onUnexpectedClose).toHaveBeenCalledTimes(1);
    expect(onUnexpectedClose).toHaveBeenCalledWith(4004, "server exited");
    expect(received).toEqual([
      { jsonrpc: "2.0", id: 0, result: null },
      { jsonrpc: "2.0", id: 1, result: null },
    ]);
    expect(transport.getTrackedDocumentMapSizes()).toEqual({
      documentUris: 0,
      sentByPath: 0,
    });
    const state = transport.state.value;
    expect(state.state).toBe("closed");
    expect(state.state === "closed" && state.error?.message).toBe(
      "server exited",
    );
  });

  it("answers requests sent after the close with null", async () => {
    const { transport, socket } = await connectOpenTransport();
    const received = collectMessages(transport);
    socket.emitClose(1006, "");

    await transport.send(documentRequest(9, "textDocument/hover", A_URI));
    await flushAsyncWork();

    expect(received).toEqual([{ jsonrpc: "2.0", id: 9, result: null }]);
    expect(socket.send).not.toHaveBeenCalled();
  });
});
