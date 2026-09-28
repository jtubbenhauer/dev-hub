import { getOmoDialogLedger } from "@/lib/omo/facade/read-runtime";
import type {
  OmoRegistryEvent,
  OmoRuntime,
  OmoSessionRegistryWorkspace,
} from "@/lib/omo/session-registry";

const KEEPALIVE_INTERVAL_MS = 30_000;

export type CreateOmoWorkspaceEventStreamOptions = {
  readonly workspace: OmoSessionRegistryWorkspace;
  readonly runtime: OmoRuntime;
  readonly signal: AbortSignal;
};

export type OmoWorkspaceEventStream = {
  readonly stream: ReadableStream<Uint8Array>;
  readonly dispose: () => void;
};

type OmoWorkspaceConnectionEvent = {
  readonly type: "workspace.connection";
  readonly properties: { readonly status: "connected" | "disconnected" };
};

export function createOmoWorkspaceEventStream(
  options: CreateOmoWorkspaceEventStreamOptions,
): OmoWorkspaceEventStream {
  const { workspace, runtime, signal } = options;
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  let keepalive: ReturnType<typeof setInterval> | undefined;
  let unsubscribe: (() => void) | undefined;
  let stopLifecycleListener: (() => void) | undefined;
  let closed = false;

  function dispose(): void {
    if (closed) return;
    closed = true;
    if (keepalive !== undefined) clearInterval(keepalive);
    keepalive = undefined;
    signal.removeEventListener("abort", dispose);
    stopLifecycleListener?.();
    stopLifecycleListener = undefined;
    unsubscribe?.();
    unsubscribe = undefined;
    const activeController = controller;
    controller = undefined;
    if (activeController === undefined) return;
    try {
      activeController.close();
    } catch {
      return;
    }
  }

  function enqueueChunk(chunk: string): void {
    if (closed || controller === undefined) return;
    try {
      controller.enqueue(encoder.encode(chunk));
    } catch {
      dispose();
    }
  }

  function enqueueEvent(
    event: OmoRegistryEvent | OmoWorkspaceConnectionEvent,
  ): void {
    const wrapped = JSON.stringify({ workspaceId: workspace.id, event });
    enqueueChunk(`data: ${wrapped}\n\n`);
  }

  const stream = new ReadableStream<Uint8Array>({
    start(streamController) {
      controller = streamController;
      signal.addEventListener("abort", dispose, { once: true });
      if (signal.aborted) {
        dispose();
        return;
      }

      unsubscribe = runtime.registry.subscribe(workspace.id, enqueueEvent);
      stopLifecycleListener = runtime.client.on((record) => {
        if (record["type"] === "__devhub_connected") {
          enqueueEvent({
            type: "workspace.connection",
            properties: { status: "connected" },
          });
          return;
        }
        if (record["type"] !== "__devhub_disconnected") return;
        enqueueEvent({
          type: "workspace.connection",
          properties: { status: "disconnected" },
        });
        if (closed || signal.aborted) dispose();
      });
      keepalive = setInterval(
        () => enqueueChunk(": keepalive\n\n"),
        KEEPALIVE_INTERVAL_MS,
      );

      for (const request of getOmoDialogLedger(runtime).requestsForWorkspace(
        workspace.id,
      )) {
        enqueueEvent({ type: "question.asked", properties: request });
      }
    },
    cancel() {
      dispose();
    },
  });

  return { stream, dispose };
}
