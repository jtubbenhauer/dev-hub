import type { Duplex } from "node:stream";
import {
  OmoIncompatibleHostError,
  OmoOpenInFlightError,
} from "@/lib/omo/errors";
import {
  createJsonlDecoder,
  encodeJsonl,
  type JsonlRecord,
} from "@/lib/omo/jsonl";
import type { OmoRpcListener } from "@/lib/omo/rpc-listeners";
import {
  commandErrorFromResponse,
  OMO_CLIENT_CAPABILITIES,
  readCompatibleProtocolInfo,
  readOpenedSession,
  recordString,
  type OmoOpenedSession,
  type OmoProtocolInfo,
  type OmoRequestOptions,
  type OmoSessionBoundListener,
} from "@/lib/omo/rpc-protocol";
import { OmoPreBindBuffer } from "@/lib/omo/rpc-session-buffer";
import type { Transport } from "@/lib/omo/rpc-transport";

export type { OmoRpcListener } from "@/lib/omo/rpc-listeners";
export type * from "@/lib/omo/rpc-protocol";
export { UnixSocketTransport } from "@/lib/omo/rpc-transport";
export type { Transport } from "@/lib/omo/rpc-transport";

type PendingRequest = {
  readonly resolve: (record: JsonlRecord) => void;
  readonly reject: (error: unknown) => void;
  readonly onResponse?: (response: JsonlRecord) => void;
  readonly command: string;
  readonly timer: NodeJS.Timeout;
};

export class OmoRpcClient {
  private readonly transport: Transport;
  private pendingRequests = new Map<string, PendingRequest>();
  private genericListeners = new Set<OmoRpcListener>();
  private sessionListeners = new Map<string, Set<OmoRpcListener>>();
  private readonly preBindBuffer = new OmoPreBindBuffer();
  private requestCounter = 0;
  private openSessionInFlight = false;
  private protocolInfo: OmoProtocolInfo | undefined;
  private socket: Duplex | undefined;
  private activeOperationCount = 0;

  constructor({ transport }: { readonly transport: Transport }) {
    this.transport = transport;
  }

  get isConnected(): boolean {
    return this.protocolInfo !== undefined;
  }

  get inFlightOps(): number {
    return this.activeOperationCount;
  }

  async connect(): Promise<OmoProtocolInfo> {
    this.socket = await this.transport.connect();
    const decoder = createJsonlDecoder((record) => this.handleRecord(record));
    this.socket.on("data", (chunk: string | Uint8Array) =>
      decoder.write(chunk),
    );
    this.socket.on("end", decoder.end);
    this.socket.on("error", () => undefined);

    await this.request({
      type: "set_client_info",
      width: 120,
      capabilities: [...OMO_CLIENT_CAPABILITIES],
    });
    const response = await this.request({ type: "get_protocol_info" });
    this.protocolInfo = readCompatibleProtocolInfo(response);
    return this.protocolInfo;
  }

  request(
    record: JsonlRecord,
    options?: OmoRequestOptions,
  ): Promise<JsonlRecord> {
    const socket = this.socket;
    if (socket === undefined) {
      return Promise.reject(new Error("OmO RPC transport is not connected"));
    }

    const id = `dh-${++this.requestCounter}`;
    const command = recordString(record, "type") ?? "unknown";
    const timeoutMs = options?.timeoutMs ?? 30_000;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error("Timed out waiting for OmO response"));
      }, timeoutMs);
      this.pendingRequests.set(id, {
        resolve,
        reject,
        command,
        timer,
        ...(options?.onResponse ? { onResponse: options.onResponse } : {}),
      });
      socket.write(encodeJsonl({ ...record, id }));
    });
  }

  on(listener: OmoRpcListener): () => void {
    this.genericListeners.add(listener);
    return () => this.genericListeners.delete(listener);
  }

  onSession(sessionId: string, listener: OmoRpcListener): () => void {
    let listeners = this.sessionListeners.get(sessionId);
    if (listeners === undefined) {
      listeners = new Set();
      this.sessionListeners.set(sessionId, listeners);
    }
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  async openSession(
    params: JsonlRecord,
    onBound: OmoSessionBoundListener,
  ): Promise<OmoOpenedSession> {
    if (this.openSessionInFlight) throw new OmoOpenInFlightError();
    this.openSessionInFlight = true;
    let opened: OmoOpenedSession | undefined;
    try {
      await this.request(
        { type: "open_session", ...params },
        {
          onResponse: (response) => {
            opened = readOpenedSession(response);
            const { records, overflowed } = this.preBindBuffer.take(
              opened.sessionId,
            );
            onBound(opened, records, overflowed);
          },
        },
      );
    } finally {
      this.openSessionInFlight = false;
    }
    if (opened === undefined) throw new OmoIncompatibleHostError(undefined);
    return opened;
  }

  close(): void {
    this.socket?.destroy();
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timer);
    }
    this.pendingRequests.clear();
    this.genericListeners.clear();
    this.sessionListeners.clear();
    this.preBindBuffer.clear();
  }

  listenerCount(): number {
    return (
      this.genericListeners.size +
      [...this.sessionListeners.values()].reduce(
        (sum, listeners) => sum + listeners.size,
        0,
      )
    );
  }

  beginOp(): void {
    this.activeOperationCount += 1;
  }

  endOp(): void {
    this.activeOperationCount = Math.max(0, this.activeOperationCount - 1);
  }

  private handleRecord(record: JsonlRecord): void {
    const type = recordString(record, "type");
    const id = recordString(record, "id");
    if (type === "response" && id !== undefined) {
      const pending = this.pendingRequests.get(id);
      if (pending !== undefined) {
        clearTimeout(pending.timer);
        this.pendingRequests.delete(id);
        if (record["success"] === false) {
          pending.reject(commandErrorFromResponse(record, pending.command));
          return;
        }
        if (pending.onResponse) {
          try {
            pending.onResponse(record);
          } catch (error) {
            pending.reject(error);
            return;
          }
        }
        pending.resolve(record);
        return;
      }
    }

    const sessionId = recordString(record, "sessionId");
    if (sessionId !== undefined) {
      const listeners = this.sessionListeners.get(sessionId);
      if (listeners !== undefined) {
        this.dispatch(this.genericListeners, record);
        this.dispatch(listeners, record);
        return;
      }
      this.preBindBuffer.push(sessionId, record);
      return;
    }

    this.dispatch(this.genericListeners, record);
  }

  private dispatch(
    listeners: ReadonlySet<OmoRpcListener>,
    record: JsonlRecord,
  ): void {
    for (const listener of listeners) {
      try {
        listener(record);
      } catch {
        continue;
      }
    }
  }
}
