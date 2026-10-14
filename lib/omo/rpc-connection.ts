import type { Duplex } from "node:stream";
import { OmoTransportGoneError } from "@/lib/omo/errors";
import {
  createJsonlDecoder,
  encodeJsonl,
  type JsonlRecord,
} from "@/lib/omo/jsonl";
import type { OmoRpcListeners } from "@/lib/omo/rpc-listeners";
import {
  commandErrorFromResponse,
  recordString,
  type OmoRequestOptions,
} from "@/lib/omo/rpc-protocol";
import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  OmoRequestDeadline,
  type OmoCompactionTracker,
} from "@/lib/omo/rpc-request-deadline";
import type { OmoPreBindBuffer } from "@/lib/omo/rpc-session-buffer";

export type OmoPendingRequest = {
  readonly resolve: (record: JsonlRecord) => void;
  readonly reject: (error: unknown) => void;
  readonly onResponse?: (response: JsonlRecord) => void;
  readonly command: string;
  readonly isInternal: boolean;
  readonly deadline: OmoRequestDeadline;
};

type BindOmoSocketOptions = {
  readonly socket: Duplex;
  readonly onRecord: (record: JsonlRecord) => void;
  readonly onTransportGone: (socket: Duplex) => void;
};

type SendOmoRequestOptions = {
  readonly socket: Duplex | undefined;
  readonly id: string;
  readonly record: JsonlRecord;
  readonly requestOptions?: OmoRequestOptions;
  readonly isInternal: boolean;
  readonly pendingRequests: Map<string, OmoPendingRequest>;
  readonly compactions: OmoCompactionTracker;
};

type RouteOmoRecordOptions = {
  readonly record: JsonlRecord;
  readonly pendingRequests: Map<string, OmoPendingRequest>;
  readonly listeners: OmoRpcListeners;
  readonly preBindBuffer: OmoPreBindBuffer;
  readonly onExternalResponse: () => void;
};

export function bindOmoSocket(options: BindOmoSocketOptions): void {
  const { socket, onRecord, onTransportGone } = options;
  const decoder = createJsonlDecoder(onRecord);
  socket.on("data", (chunk: string | Uint8Array) => decoder.write(chunk));
  socket.once("end", () => {
    decoder.end();
    onTransportGone(socket);
  });
  socket.once("close", () => onTransportGone(socket));
  socket.once("error", () => {
    onTransportGone(socket);
    socket.destroy();
  });
}

export function sendOmoRequest(
  request: SendOmoRequestOptions,
): Promise<JsonlRecord> {
  const {
    socket,
    id,
    record,
    requestOptions,
    isInternal,
    pendingRequests,
    compactions,
  } = request;
  if (socket === undefined || socket.destroyed) {
    return Promise.reject(new OmoTransportGoneError());
  }

  const command = recordString(record, "type") ?? "unknown";
  return new Promise((resolve, reject) => {
    const deadline = new OmoRequestDeadline({
      command,
      sessionId: recordString(record, "sessionId"),
      timeoutMs: requestOptions?.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
      compactions,
      onExpire: () => {
        pendingRequests.delete(id);
        reject(new Error("Timed out waiting for OmO response"));
      },
    });
    pendingRequests.set(id, {
      resolve,
      reject,
      command,
      isInternal,
      deadline,
      ...(requestOptions?.onResponse
        ? { onResponse: requestOptions.onResponse }
        : {}),
    });
    socket.write(encodeJsonl({ ...record, id }));
  });
}

export function writeOmoRecord(
  socket: Duplex | undefined,
  record: JsonlRecord,
): void {
  if (socket === undefined || socket.destroyed) {
    throw new OmoTransportGoneError();
  }
  socket.write(encodeJsonl(record));
}

export function rejectPendingOmoRequests(
  pendingRequests: Map<string, OmoPendingRequest>,
): void {
  for (const pending of pendingRequests.values()) {
    pending.deadline.clear();
    pending.reject(new OmoTransportGoneError());
  }
  pendingRequests.clear();
}

export function routeOmoRecord(options: RouteOmoRecordOptions): boolean {
  const {
    record,
    pendingRequests,
    listeners,
    preBindBuffer,
    onExternalResponse,
  } = options;
  const type = recordString(record, "type");
  const isHostSuperseded = type === "host_superseded";
  if (type === "queued") {
    // The host's receipt for a request, addressed by for_request, not id.
    const requestId = recordString(record, "for_request");
    if (requestId !== undefined) {
      pendingRequests.get(requestId)?.deadline.acknowledge();
    }
    return false;
  }
  const id = recordString(record, "id");
  if (type === "response" && id !== undefined) {
    const pending = pendingRequests.get(id);
    if (pending !== undefined) {
      pending.deadline.clear();
      pendingRequests.delete(id);
      if (!pending.isInternal) onExternalResponse();
      if (record["success"] === false) {
        pending.reject(commandErrorFromResponse(record, pending.command));
        return isHostSuperseded;
      }
      if (pending.onResponse) {
        try {
          pending.onResponse(record);
        } catch (error) {
          pending.reject(error);
          return isHostSuperseded;
        }
      }
      pending.resolve(record);
      return isHostSuperseded;
    }
  }

  const sessionId = recordString(record, "sessionId");
  if (sessionId !== undefined) {
    if (listeners.hasSession(sessionId)) {
      listeners.dispatch(record, sessionId);
      return isHostSuperseded;
    }
    preBindBuffer.push(sessionId, record);
    return isHostSuperseded;
  }

  listeners.dispatch(record);
  return isHostSuperseded;
}
