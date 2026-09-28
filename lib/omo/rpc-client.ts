import type { Duplex } from "node:stream";
import { pingOmoDaemon } from "@/lib/omo/daemon";
import { OmoTransportGoneError } from "@/lib/omo/errors";
import type { JsonlRecord } from "@/lib/omo/jsonl";
import {
  bindOmoSocket,
  rejectPendingOmoRequests,
  routeOmoRecord,
  sendOmoRequest,
  writeOmoRecord,
  type OmoPendingRequest,
} from "@/lib/omo/rpc-connection";
import { OmoRpcLifecycle } from "@/lib/omo/rpc-lifecycle";
import { OmoRpcListeners, type OmoRpcListener } from "@/lib/omo/rpc-listeners";
import {
  OMO_CLIENT_CAPABILITIES,
  readCompatibleProtocolInfo,
  type OmoOpenedSession,
  type OmoProtocolInfo,
  type OmoRequestOptions,
  type OmoSessionBoundListener,
} from "@/lib/omo/rpc-protocol";
import { OmoSessionOpener } from "@/lib/omo/rpc-session-open";
import type { Transport } from "@/lib/omo/rpc-transport";

export type { OmoRpcClientState } from "@/lib/omo/rpc-lifecycle";
export type { OmoRpcListener } from "@/lib/omo/rpc-listeners";
export type * from "@/lib/omo/rpc-protocol";
export { UnixSocketTransport } from "@/lib/omo/rpc-transport";
export { WebSocketTransport } from "@/lib/omo/rpc-ws-transport";
export type { Transport } from "@/lib/omo/rpc-transport";

export class OmoRpcClient {
  private readonly transport: Transport;
  private pendingRequests = new Map<string, OmoPendingRequest>();
  private readonly listeners = new OmoRpcListeners();
  private readonly sessionOpener = new OmoSessionOpener();
  private readonly intentionallyClosedSockets = new WeakSet<Duplex>();
  private readonly handledSockets = new WeakSet<Duplex>();
  private readonly lifecycle: OmoRpcLifecycle;
  private requestCounter = 0;
  private protocolInfo: OmoProtocolInfo | undefined;
  private socket: Duplex | undefined;
  private connectPromise: Promise<OmoProtocolInfo> | undefined;
  superseded = false;

  constructor({ transport }: { readonly transport: Transport }) {
    this.transport = transport;
    this.lifecycle = new OmoRpcLifecycle({
      reconnect: async () => {
        await this.connect();
      },
      ping: () => this.pingHealth(),
      forceReconnect: () => this.forceReconnect(),
      disconnectIdle: () => this.disconnectIdle(),
      hasPendingRequests: () => this.pendingRequests.size > 0,
    });
  }

  get isConnected(): boolean {
    return this.protocolInfo !== undefined;
  }

  get state() {
    return this.lifecycle.state;
  }

  get inFlightOps(): number {
    return this.lifecycle.inFlightOps;
  }

  async connect(): Promise<OmoProtocolInfo> {
    if (this.lifecycle.isClosed) throw new OmoTransportGoneError();
    if (this.protocolInfo !== undefined && this.socket !== undefined) {
      return this.protocolInfo;
    }
    const activeConnect = this.connectPromise;
    if (activeConnect !== undefined) return activeConnect;

    const connectPromise = this.establishConnection();
    this.connectPromise = connectPromise;
    try {
      return await connectPromise;
    } finally {
      if (this.connectPromise === connectPromise) {
        this.connectPromise = undefined;
      }
    }
  }

  reconnect(): Promise<OmoProtocolInfo> {
    return this.connect();
  }

  async request(
    record: JsonlRecord,
    options?: OmoRequestOptions,
  ): Promise<JsonlRecord> {
    this.lifecycle.recordExternalActivity();
    if (this.state === "idle" || this.state === "connecting") {
      await this.connect();
    }
    return this.sendRequest(record, options, false);
  }

  // Writes a record verbatim with no id rewrite and no pending-request
  // tracking, for host commands that never send a "response" (for example
  // extension_ui_response, which must echo the host's original request id).
  sendFireAndForget(record: JsonlRecord): void {
    this.lifecycle.recordExternalActivity();
    writeOmoRecord(this.socket, record);
  }

  on(listener: OmoRpcListener): () => void {
    return this.listeners.add(listener);
  }

  onSession(sessionId: string, listener: OmoRpcListener): () => void {
    return this.listeners.addSession(sessionId, listener);
  }

  async openSession(
    params: JsonlRecord,
    onBound: OmoSessionBoundListener,
  ): Promise<OmoOpenedSession> {
    return this.sessionOpener.open(params, onBound, (record, options) =>
      this.request(record, options),
    );
  }

  close(): void {
    this.lifecycle.close();
    const socket = this.socket;
    this.socket = undefined;
    this.protocolInfo = undefined;
    if (socket !== undefined) {
      this.intentionallyClosedSockets.add(socket);
      socket.destroy();
    }
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timer);
    }
    this.pendingRequests.clear();
    this.listeners.clear();
    this.sessionOpener.clear();
  }

  listenerCount(): number {
    return this.listeners.count();
  }

  beginOp(): void {
    this.lifecycle.beginOp();
  }

  endOp(): void {
    this.lifecycle.endOp();
  }

  addSubscriber(): void {
    this.lifecycle.addSubscriber();
  }

  removeSubscriber(): void {
    this.lifecycle.removeSubscriber();
  }

  beginSubscription(): void {
    this.addSubscriber();
  }

  endSubscription(): void {
    this.removeSubscriber();
  }

  private async establishConnection(): Promise<OmoProtocolInfo> {
    this.lifecycle.markConnecting();
    let socket: Duplex | undefined;
    try {
      socket = await this.transport.connect();
      if (this.lifecycle.isClosed) throw new OmoTransportGoneError();
      this.socket = socket;
      this.attachSocket(socket);
      await this.sendRequest(
        {
          type: "set_client_info",
          width: 120,
          capabilities: [...OMO_CLIENT_CAPABILITIES],
        },
        undefined,
        true,
      );
      const response = await this.sendRequest(
        { type: "get_protocol_info" },
        undefined,
        true,
      );
      const protocolInfo = readCompatibleProtocolInfo(response);
      this.protocolInfo = protocolInfo;
      this.lifecycle.connected();
      this.listeners.dispatch({ type: "__devhub_connected", protocolInfo });
      return protocolInfo;
    } catch (error) {
      if (socket !== undefined) {
        this.intentionallyClosedSockets.add(socket);
        socket.destroy();
        if (this.socket === socket) this.socket = undefined;
      }
      this.protocolInfo = undefined;
      this.lifecycle.markConnectionFailed();
      throw error;
    }
  }

  private attachSocket(socket: Duplex): void {
    bindOmoSocket({
      socket,
      onRecord: (record) => this.handleRecord(record),
      onTransportGone: (closedSocket) => this.handleTransportGone(closedSocket),
    });
  }

  private sendRequest(
    record: JsonlRecord,
    options: OmoRequestOptions | undefined,
    isInternal: boolean,
  ): Promise<JsonlRecord> {
    const id = `dh-${++this.requestCounter}`;
    return sendOmoRequest({
      socket: this.socket,
      id,
      record,
      ...(options ? { requestOptions: options } : {}),
      isInternal,
      pendingRequests: this.pendingRequests,
    });
  }

  private handleTransportGone(socket: Duplex): void {
    if (this.handledSockets.has(socket)) return;
    this.handledSockets.add(socket);
    if (this.intentionallyClosedSockets.has(socket) || this.socket !== socket) {
      return;
    }

    this.socket = undefined;
    this.protocolInfo = undefined;
    this.listeners.dispatchAll({ type: "__devhub_disconnected" });
    rejectPendingOmoRequests(this.pendingRequests);
    const reconnectImmediately = this.superseded;
    if (reconnectImmediately) this.superseded = false;
    this.lifecycle.transportGone(reconnectImmediately);
  }

  private pingHealth(): Promise<void> {
    return pingOmoDaemon({
      request: (record, options) => this.sendRequest(record, options, true),
    });
  }

  private forceReconnect(): void {
    if (this.superseded) return;
    const socket = this.socket;
    if (socket === undefined) return;
    this.handleTransportGone(socket);
    socket.destroy();
  }

  private disconnectIdle(): void {
    const socket = this.socket;
    this.socket = undefined;
    this.protocolInfo = undefined;
    if (socket === undefined) return;
    this.intentionallyClosedSockets.add(socket);
    socket.destroy();
  }

  private handleRecord(record: JsonlRecord): void {
    const isHostSuperseded = routeOmoRecord({
      record,
      pendingRequests: this.pendingRequests,
      listeners: this.listeners,
      preBindBuffer: this.sessionOpener.preBindBuffer,
      onExternalResponse: () => this.lifecycle.recordExternalActivity(),
    });
    if (isHostSuperseded) this.superseded = true;
  }
}
