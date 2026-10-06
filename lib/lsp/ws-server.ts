// allow: SIZE_OK — Task 8 owns only this file; the trace helper lives here to keep the plan's file ownership.
import { appendFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { createCaseResolver } from "@/lib/lsp/case-resolver";
import { isLspDocumentUriInWorkspace } from "@/lib/lsp/document-scope";
import {
  createLspBridgeSession,
  type BridgeOutput,
} from "@/lib/lsp/message-bridge";
import type { LspServerManager } from "@/lib/lsp/server-manager";
import {
  isJsonRpcNotification,
  isJsonRpcRequest,
  isJsonRpcResponse,
  LSP_CLOSE_CODES,
  LSP_DEFAULT_PORT,
  LSP_PHASE1_CLIENT_NOTIFICATIONS,
  LSP_PHASE1_CLIENT_REQUESTS,
  LSP_PHASE1_DYNAMIC_METHODS,
  LSP_PHASE1_SERVER_CAPABILITIES,
  type JsonRpcId,
  type JsonRpcMessage,
} from "@/lib/lsp/types";
import { VTSLS_SETTINGS } from "@/lib/lsp/vtsls-settings";

const HEARTBEAT_INTERVAL_MS = 30_000;
const TRACE_PENDING_LIMIT = 10_000;

type LspWsServer = {
  readonly manager: LspServerManager;
  readonly ready: Promise<{ port: number }>;
  readonly httpServer: Server;
  readonly wss: WebSocketServer;
  readonly heartbeat: ReturnType<typeof setInterval>;
};

type TraceDirection = "c2s" | "s2c";

type TraceEntry = {
  ts: string;
  dir: TraceDirection;
  kind: "request" | "notification" | "response";
  method?: string;
  id?: JsonRpcId | null;
  resultNonEmpty?: boolean;
  documentInWorkspace?: boolean;
};

declare global {
  var __devhubLspWsServer: LspWsServer | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isJsonRpcMessage(value: unknown): value is JsonRpcMessage {
  return (
    isJsonRpcRequest(value) ||
    isJsonRpcNotification(value) ||
    isJsonRpcResponse(value)
  );
}

function getTextDocumentUri(message: JsonRpcMessage): string | null {
  const params = "params" in message ? message.params : undefined;
  if (!isRecord(params) || !isRecord(params.textDocument)) return null;
  const uri = params.textDocument.uri;
  return typeof uri === "string" ? uri : null;
}

function hasNonEmptyResult(result: unknown): boolean {
  const data = isRecord(result) ? result.data : undefined;
  return Array.isArray(data) ? data.length > 0 : result != null;
}

function decodeTextFrame(data: RawData, isBinary: boolean): string | null {
  if (isBinary) return null;
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  return Buffer.from(data).toString("utf8");
}

function createLspTracer(traceFile: string, workspacePath: string) {
  // Keyed by the direction the request travelled; its response travels the other way.
  const requestMethods: Record<TraceDirection, Map<JsonRpcId, string>> = {
    c2s: new Map(),
    s2c: new Map(),
  };

  function rememberRequest(direction: TraceDirection, message: JsonRpcMessage) {
    if (!isJsonRpcRequest(message)) return;
    const methods = requestMethods[direction];
    methods.set(message.id, message.method);
    if (methods.size > TRACE_PENDING_LIMIT) methods.clear();
  }

  function write(direction: TraceDirection, message: JsonRpcMessage) {
    const entry: TraceEntry = {
      ts: new Date().toISOString(),
      dir: direction,
      kind: isJsonRpcRequest(message)
        ? "request"
        : isJsonRpcNotification(message)
          ? "notification"
          : "response",
    };
    if ("method" in message) entry.method = message.method;
    if ("id" in message) entry.id = message.id;
    if (isJsonRpcResponse(message)) {
      const methods = requestMethods[direction === "c2s" ? "s2c" : "c2s"];
      const method = message.id === null ? undefined : methods.get(message.id);
      if (message.id !== null) methods.delete(message.id);
      if (method !== undefined) entry.method = method;
      entry.resultNonEmpty = hasNonEmptyResult(message.result);
    }
    const uri = getTextDocumentUri(message);
    if (uri !== null) {
      entry.documentInWorkspace = isLspDocumentUriInWorkspace(
        uri,
        workspacePath,
        { isCaseInsensitive: false },
      );
    }
    try {
      appendFileSync(traceFile, `${JSON.stringify(entry)}\n`);
    } catch (error) {
      console.warn("[lsp] trace write failed", error);
    }
  }

  return { rememberRequest, write };
}

function handleLspConnection(
  manager: LspServerManager,
  socket: WebSocket,
  request: IncomingMessage,
) {
  const params = new URL(request.url ?? "/", "http://127.0.0.1").searchParams;
  const workspacePath = manager.workspacePath;
  if (
    manager.state !== "running" ||
    manager.isShuttingDown ||
    workspacePath === null
  ) {
    socket.close(LSP_CLOSE_CODES.NOT_RUNNING, "lsp-not-running");
    return;
  }
  if (params.get("workspaceId") !== manager.workspaceId) {
    socket.close(LSP_CLOSE_CODES.WORKSPACE_MISMATCH, "lsp-workspace-mismatch");
    return;
  }
  if (Number(params.get("epoch")) !== manager.epoch) {
    socket.close(LSP_CLOSE_CODES.STALE_EPOCH, "lsp-stale-epoch");
    return;
  }
  const token = manager.attachConnection();
  if (token === null) {
    socket.close(LSP_CLOSE_CODES.BUSY, "lsp-busy");
    return;
  }

  const bridge = createLspBridgeSession({
    workspaceRoot: workspacePath,
    resolveRealCaseUri: createCaseResolver(workspacePath).resolveRealCaseUri,
    settings: VTSLS_SETTINGS,
    allowedServerCapabilities: LSP_PHASE1_SERVER_CAPABILITIES,
    allowedDynamicMethods: LSP_PHASE1_DYNAMIC_METHODS,
    allowedClientRequests: LSP_PHASE1_CLIENT_REQUESTS,
    allowedClientNotifications: LSP_PHASE1_CLIENT_NOTIFICATIONS,
  });
  const traceFile = process.env.LSP_TRACE_FILE;
  const tracer = traceFile ? createLspTracer(traceFile, workspacePath) : null;

  function route(output: BridgeOutput) {
    for (const message of output.toServer) {
      manager.sendToServer(message);
      tracer?.write("c2s", message);
    }
    for (const message of output.toClient) {
      if (socket.readyState !== WebSocket.OPEN) continue;
      socket.send(JSON.stringify(message));
      tracer?.write("s2c", message);
    }
  }

  socket.on("message", (data: RawData, isBinary: boolean) => {
    const text = decodeTextFrame(data, isBinary);
    if (text === null) {
      console.warn("[lsp] ignoring binary websocket frame");
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      console.warn("[lsp] ignoring websocket frame that is not valid JSON");
      return;
    }
    if (!isJsonRpcMessage(parsed)) {
      console.warn("[lsp] ignoring websocket frame that is not JSON-RPC");
      return;
    }
    tracer?.rememberRequest("c2s", parsed);
    route(bridge.fromClient(parsed));
  });

  const unsubscribeMessage = manager.onServerMessage((message) => {
    tracer?.rememberRequest("s2c", message);
    route(bridge.fromServer(message));
  });
  const unsubscribeExited = manager.onServerExited(() =>
    socket.close(LSP_CLOSE_CODES.SERVER_EXITED, "lsp-server-exited"),
  );
  const unsubscribeStopping = manager.onStopping(() =>
    socket.close(1000, "lsp-stopping"),
  );

  let isReleased = false;
  const release = () => {
    if (isReleased) return;
    isReleased = true;
    unsubscribeMessage();
    unsubscribeExited();
    unsubscribeStopping();
    manager.detachConnection(token);
  };
  socket.on("close", release);
  socket.on("error", (error: Error) => {
    console.warn("[lsp] websocket error", error.message);
    release();
  });
}

async function failInitialisation(server: LspWsServer, message: string) {
  if (globalThis.__devhubLspWsServer === server) {
    globalThis.__devhubLspWsServer = undefined;
  }
  try {
    await server.manager.failWithError(message);
  } catch (error) {
    console.warn("[lsp] failWithError failed", error);
  }
  clearInterval(server.heartbeat);
  try {
    server.wss.close();
  } catch (error) {
    console.debug("[lsp] websocket server close failed", error);
  }
}

function startLspWsServer(manager: LspServerManager): LspWsServer {
  const configuredPort =
    process.env.LSP_SERVER_PORT ?? String(LSP_DEFAULT_PORT);
  const requestedPort = Number(configuredPort);
  const httpServer = createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ status: "ok" }));
  });
  const wss = new WebSocketServer({ server: httpServer });
  wss.on("connection", (socket, request) =>
    handleLspConnection(manager, socket, request),
  );
  // ws re-emits http server errors; the http server handler below owns them
  wss.on("error", (error) => console.debug("[lsp] websocket server", error));
  const heartbeat = setInterval(() => {
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.ping();
    }
  }, HEARTBEAT_INTERVAL_MS);

  let resolveReady: (value: { port: number }) => void = () => {};
  let rejectReady: (error: Error) => void = () => {};
  const ready = new Promise<{ port: number }>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const server: LspWsServer = { manager, ready, httpServer, wss, heartbeat };
  const failAndReject = (message: string) => {
    void failInitialisation(server, message).then(() =>
      rejectReady(new Error(message)),
    );
  };
  globalThis.__devhubLspWsServer = server;

  httpServer.once("listening", () => {
    const address = httpServer.address();
    resolveReady({
      port:
        typeof address === "object" && address !== null
          ? address.port
          : requestedPort,
    });
  });
  httpServer.on("error", (error: NodeJS.ErrnoException) => {
    if (httpServer.listening) {
      console.warn("[lsp] websocket server error", error);
      return;
    }
    failAndReject(`LSP port ${requestedPort} in use`);
  });
  try {
    httpServer.listen(requestedPort, "127.0.0.1");
  } catch (error) {
    // listen() throws synchronously for a malformed port such as NaN.
    if (!(error instanceof RangeError)) throw error;
    failAndReject(`LSP port ${configuredPort} is invalid`);
  }
  return server;
}

export function ensureLspWsServer(
  manager: LspServerManager,
): Promise<{ port: number }> {
  const existing = globalThis.__devhubLspWsServer;
  if (existing === undefined) return startLspWsServer(manager).ready;
  if (existing.manager !== manager) {
    return Promise.reject(
      new Error(
        "LSP WebSocket server is bound to another manager — call closeLspWsServer() first",
      ),
    );
  }
  return existing.ready;
}

export async function closeLspWsServer(): Promise<void> {
  const server = globalThis.__devhubLspWsServer;
  if (server === undefined) return;
  globalThis.__devhubLspWsServer = undefined;
  const isListening = await server.ready.then(
    () => true,
    () => false,
  );
  // A failed initialisation has already released its resources.
  if (!isListening) return;
  for (const client of server.wss.clients) {
    client.close(1001, "lsp-server-closing");
  }
  clearInterval(server.heartbeat);
  try {
    server.wss.close();
  } catch (error) {
    console.debug("[lsp] websocket server close failed", error);
  }
  await new Promise<void>((resolve) => {
    server.httpServer.close((error) => {
      if (error) console.debug("[lsp] http server close failed", error);
      resolve();
    });
  });
}
