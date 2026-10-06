import {
  fileUriToAbsolutePath,
  isLspDocumentUriInWorkspace,
} from "@/lib/lsp/document-scope";
import {
  LSP_DEFINITION_METHODS,
  isJsonRpcRequest,
  isJsonRpcResponse,
  type JsonRpcId,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from "@/lib/lsp/types";

export type LspConnectionState =
  | { state: "connecting" }
  | { state: "open" }
  | { state: "closed"; error: Error | undefined };

export interface LspTransportMessage {
  jsonrpc: "2.0";
  id?: JsonRpcId | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
}

export type LspTransportMessageListener = (
  message: LspTransportMessage,
) => void;

export interface LspConnectionStateValue {
  readonly value: LspConnectionState;
  onChange(listener: (state: LspConnectionState) => void): {
    dispose(): void;
  };
}

export interface LspBrowserTransport {
  readonly state: LspConnectionStateValue;
  send(message: LspTransportMessage): Promise<void>;
  setListener(listener: LspTransportMessageListener | undefined): void;
  toString(): string;
  detach(): void;
  // read-only inspector: lets tests prove detach/close released every mapping
  getTrackedDocumentMapSizes(): { documentUris: number; sentByPath: number };
}

export interface LspBrowserTransportOptions {
  url: string;
  workspaceRoot: string;
  resolveDefinitionTargets: (result: unknown) => Promise<unknown>;
  resolveDocumentUri: (sentUri: string) => string | null;
  normalizeIncomingUri: (uri: string) => string;
  onUnexpectedClose: (code: number, reason: string) => void;
  WebSocketImpl?: typeof WebSocket;
  openTimeoutMs?: number;
}

const DEFAULT_OPEN_TIMEOUT_MS = 10_000;
const CLIENT_DETACHED_CLOSE_CODE = 1000;
const CLIENT_DETACHED_CLOSE_REASON = "client-detached";
const LOG_PREFIX = "[lsp-transport]";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isTransportMessage(value: unknown): value is LspTransportMessage {
  if (!isRecord(value) || value.jsonrpc !== "2.0") return false;
  const hasValidMethod =
    !("method" in value) || typeof value.method === "string";
  const hasValidId =
    !("id" in value) ||
    value.id === null ||
    typeof value.id === "number" ||
    typeof value.id === "string";
  return hasValidMethod && hasValidId;
}

function isDefinitionMethod(method: string): boolean {
  return (LSP_DEFINITION_METHODS as readonly string[]).includes(method);
}

function getTextDocumentUri(message: LspTransportMessage): string | null {
  if (!isRecord(message.params)) return null;
  const textDocument = message.params.textDocument;
  if (!isRecord(textDocument)) return null;
  return typeof textDocument.uri === "string" ? textDocument.uri : null;
}

function cloneWithTextDocumentUri(
  message: LspTransportMessage,
  uri: string,
): LspTransportMessage {
  const params = isRecord(message.params) ? message.params : {};
  const textDocument = isRecord(params.textDocument) ? params.textDocument : {};
  return {
    ...message,
    params: { ...params, textDocument: { ...textDocument, uri } },
  };
}

function getPathKey(uri: string): string | undefined {
  return fileUriToAbsolutePath(uri)?.toLowerCase();
}

function rewriteLocationUris(
  location: unknown,
  rewriteUri: (uri: string) => string,
): unknown {
  if (!isRecord(location)) return location;
  const rewritten: Record<string, unknown> = { ...location };
  if (typeof location.uri === "string") {
    rewritten.uri = rewriteUri(location.uri);
  }
  if (typeof location.targetUri === "string") {
    rewritten.targetUri = rewriteUri(location.targetUri);
  }
  return rewritten;
}

function rewriteDefinitionResult(
  result: unknown,
  rewriteUri: (uri: string) => string,
): unknown {
  if (Array.isArray(result)) {
    return result.map((location) => rewriteLocationUris(location, rewriteUri));
  }
  return rewriteLocationUris(result, rewriteUri);
}

function closeSocketQuietly(socket: WebSocket, code?: number, reason?: string) {
  try {
    socket.close(code, reason);
  } catch (error) {
    console.warn(`${LOG_PREFIX} socket close failed`, error);
  }
}

function createConnectionStateHolder(initialState: LspConnectionState) {
  let currentState = initialState;
  const stateListeners = new Set<(state: LspConnectionState) => void>();
  const view: LspConnectionStateValue = {
    get value() {
      return currentState;
    },
    onChange(listener) {
      stateListeners.add(listener);
      return { dispose: () => stateListeners.delete(listener) };
    },
  };
  const setState = (nextState: LspConnectionState) => {
    currentState = nextState;
    for (const listener of [...stateListeners]) listener(nextState);
  };
  return { view, setState };
}

class DevHubLspBrowserTransport implements LspBrowserTransport {
  readonly state: LspConnectionStateValue;
  private readonly setState: (state: LspConnectionState) => void;
  private listener: LspTransportMessageListener | undefined;
  private readonly undeliveredMessages: LspTransportMessage[] = [];
  private readonly pendingMethodsById = new Map<JsonRpcId, string>();
  private readonly documentUris = new Map<string, string>();
  private readonly sentByPath = new Map<string, string>();
  private isDetached = false;

  constructor(
    private readonly socket: WebSocket,
    private readonly options: LspBrowserTransportOptions,
  ) {
    const stateHolder = createConnectionStateHolder({ state: "open" });
    this.state = stateHolder.view;
    this.setState = stateHolder.setState;
    socket.addEventListener("message", (event) =>
      this.handleSocketMessage(event),
    );
    socket.addEventListener("close", (event) =>
      this.handleSocketClose(event.code, event.reason),
    );
  }

  setListener(listener: LspTransportMessageListener | undefined): void {
    this.listener = listener;
    while (this.listener && this.undeliveredMessages.length > 0) {
      const nextMessage = this.undeliveredMessages.shift();
      if (nextMessage === undefined) break;
      this.deliver(nextMessage);
    }
  }

  async send(message: LspTransportMessage): Promise<void> {
    try {
      this.sendOrAnswerLocally(message);
    } catch (error) {
      console.warn(`${LOG_PREFIX} send failed`, error);
    }
  }

  detach(): void {
    if (this.isDetached) return;
    this.isDetached = true;
    this.answerPendingRequestsWithNull();
    this.clearDocumentMaps();
    closeSocketQuietly(
      this.socket,
      CLIENT_DETACHED_CLOSE_CODE,
      CLIENT_DETACHED_CLOSE_REASON,
    );
    if (this.state.value.state !== "closed") {
      this.setState({ state: "closed", error: undefined });
    }
  }

  getTrackedDocumentMapSizes() {
    return {
      documentUris: this.documentUris.size,
      sentByPath: this.sentByPath.size,
    };
  }

  toString(): string {
    return `devhub-lsp-transport(${this.options.url})`;
  }

  private isInert(): boolean {
    return this.isDetached || this.state.value.state === "closed";
  }

  private deliver(message: LspTransportMessage): void {
    const listener = this.listener;
    if (!listener) {
      this.undeliveredMessages.push(message);
      return;
    }
    try {
      listener(message);
    } catch (error) {
      console.warn(`${LOG_PREFIX} listener threw`, error);
    }
  }

  private answerWithNullLater(id: JsonRpcId): void {
    queueMicrotask(() => this.deliver({ jsonrpc: "2.0", id, result: null }));
  }

  private answerPendingRequestsWithNull(): void {
    for (const id of this.pendingMethodsById.keys()) {
      this.answerWithNullLater(id);
    }
    this.pendingMethodsById.clear();
  }

  private clearDocumentMaps(): void {
    this.documentUris.clear();
    this.sentByPath.clear();
  }

  private sendOrAnswerLocally(message: LspTransportMessage): void {
    const request = isJsonRpcRequest(message) ? message : null;
    if (this.isInert()) {
      if (request) this.answerWithNullLater(request.id);
      return;
    }
    const sentUri = getTextDocumentUri(message);
    if (sentUri === null) {
      this.sendToSocket(message, request);
      return;
    }
    this.sendDocumentMessage(message, sentUri, request);
  }

  private sendDocumentMessage(
    message: LspTransportMessage,
    sentUri: string,
    request: JsonRpcRequest | null,
  ): void {
    const sentKey = sentUri.toLowerCase();
    const fullUri =
      this.documentUris.get(sentKey) ??
      this.options.resolveDocumentUri(sentUri);
    if (
      fullUri === null ||
      !isLspDocumentUriInWorkspace(fullUri, this.options.workspaceRoot, {
        isCaseInsensitive: true,
      })
    ) {
      if (request) this.answerWithNullLater(request.id);
      return;
    }
    if (message.method === "textDocument/didOpen") {
      this.rememberDocument(sentKey, sentUri, fullUri);
    }
    this.sendToSocket(cloneWithTextDocumentUri(message, fullUri), request);
    if (message.method === "textDocument/didClose") {
      this.forgetDocument(sentKey, fullUri);
    }
  }

  private sendToSocket(
    message: LspTransportMessage,
    request: JsonRpcRequest | null,
  ): void {
    if (request) this.pendingMethodsById.set(request.id, request.method);
    try {
      this.socket.send(JSON.stringify(message));
    } catch (error) {
      console.warn(`${LOG_PREFIX} socket send failed`, error);
      if (request) {
        this.pendingMethodsById.delete(request.id);
        this.answerWithNullLater(request.id);
      }
    }
  }

  private rememberDocument(sentKey: string, sentUri: string, fullUri: string) {
    this.documentUris.set(sentKey, fullUri);
    const pathKey = getPathKey(fullUri);
    if (pathKey !== undefined) this.sentByPath.set(pathKey, sentUri);
  }

  private forgetDocument(sentKey: string, fullUri: string) {
    this.documentUris.delete(sentKey);
    const pathKey = getPathKey(fullUri);
    if (pathKey !== undefined) this.sentByPath.delete(pathKey);
  }

  private rewriteIncomingUri(uri: string): string {
    const pathKey = getPathKey(uri);
    const sentUri =
      pathKey === undefined ? undefined : this.sentByPath.get(pathKey);
    return sentUri ?? this.options.normalizeIncomingUri(uri);
  }

  private handleSocketMessage(event: MessageEvent): void {
    if (this.isInert()) return;
    let parsed: unknown;
    try {
      parsed = typeof event.data === "string" ? JSON.parse(event.data) : null;
    } catch (error) {
      console.warn(`${LOG_PREFIX} ignoring unparsable frame`, error);
      return;
    }
    if (!isTransportMessage(parsed)) {
      console.warn(`${LOG_PREFIX} ignoring non JSON-RPC frame`);
      return;
    }
    this.handleIncomingMessage(parsed).catch((error: unknown) =>
      console.warn(`${LOG_PREFIX} failed to handle incoming message`, error),
    );
  }

  private async handleIncomingMessage(
    message: LspTransportMessage,
  ): Promise<void> {
    if (isJsonRpcResponse(message)) {
      await this.handleIncomingResponse(message);
      return;
    }
    if (
      message.method === "textDocument/publishDiagnostics" &&
      isRecord(message.params) &&
      typeof message.params.uri === "string"
    ) {
      const uri = this.rewriteIncomingUri(message.params.uri);
      this.deliver({ ...message, params: { ...message.params, uri } });
      return;
    }
    this.deliver(message);
  }

  private async handleIncomingResponse(
    response: LspTransportMessage & JsonRpcResponse,
  ): Promise<void> {
    const id = response.id;
    const method = id === null ? undefined : this.pendingMethodsById.get(id);
    if (
      id === null ||
      method === undefined ||
      !isDefinitionMethod(method) ||
      response.error !== undefined
    ) {
      if (id !== null) this.pendingMethodsById.delete(id);
      this.deliver(response);
      return;
    }
    const resolvedResult = await this.resolveDefinitionTargetsSafely(
      response.result,
    );
    // detach/close already answered this id with null while we awaited
    if (!this.pendingMethodsById.has(id)) return;
    this.pendingMethodsById.delete(id);
    const result = rewriteDefinitionResult(resolvedResult, (uri) =>
      this.rewriteIncomingUri(uri),
    );
    this.deliver({ ...response, result });
  }

  private async resolveDefinitionTargetsSafely(
    result: unknown,
  ): Promise<unknown> {
    try {
      return await this.options.resolveDefinitionTargets(result ?? null);
    } catch (error) {
      console.warn(`${LOG_PREFIX} definition target resolution failed`, error);
      return null;
    }
  }

  private handleSocketClose(code: number, reason: string): void {
    if (this.isInert()) return;
    const message = reason || `LSP socket closed with code ${code}`;
    this.setState({ state: "closed", error: new Error(message) });
    this.answerPendingRequestsWithNull();
    this.clearDocumentMaps();
    this.options.onUnexpectedClose(code, reason);
  }
}

export function connectLspBrowserTransport(
  options: LspBrowserTransportOptions,
): Promise<LspBrowserTransport> {
  const WebSocketImpl = options.WebSocketImpl ?? globalThis.WebSocket;
  const openTimeoutMs = options.openTimeoutMs ?? DEFAULT_OPEN_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    const socket = new WebSocketImpl(options.url);
    let isSettled = false;

    const handleOpen = () => {
      if (isSettled) return;
      isSettled = true;
      removeHandshakeListeners();
      resolve(new DevHubLspBrowserTransport(socket, options));
    };
    const failHandshake = (error: Error) => {
      if (isSettled) return;
      isSettled = true;
      removeHandshakeListeners();
      closeSocketQuietly(socket);
      reject(error);
    };
    const handleError = () =>
      failHandshake(new Error(`LSP socket error before open: ${options.url}`));
    const handleClose = (event: CloseEvent) =>
      failHandshake(
        new Error(
          `LSP socket closed before open (code ${event.code}${event.reason ? `: ${event.reason}` : ""})`,
        ),
      );
    const openTimer = setTimeout(
      () =>
        failHandshake(
          new Error(`LSP socket open timed out after ${openTimeoutMs}ms`),
        ),
      openTimeoutMs,
    );
    function removeHandshakeListeners() {
      clearTimeout(openTimer);
      socket.removeEventListener("open", handleOpen);
      socket.removeEventListener("error", handleError);
      socket.removeEventListener("close", handleClose);
    }

    socket.addEventListener("open", handleOpen);
    socket.addEventListener("error", handleError);
    socket.addEventListener("close", handleClose);
  });
}
