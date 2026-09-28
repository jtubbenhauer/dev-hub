import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { workspaces } from "@/drizzle/schema";
import { eq, and, inArray } from "drizzle-orm";
import { getBackend, toWorkspace } from "@/lib/workspaces/backend";
import { superviseSseTarget } from "@/lib/opencode/sse-supervisor";
import { resolveWorkspaceEngine } from "@/lib/engine/resolve-engine";
import type { OmoRuntimeWorkspace } from "@/lib/omo/runtime";

export const maxDuration = 300;

const KEEPALIVE_INTERVAL_MS = 30_000;

interface UpstreamTarget {
  workspaceId: string;
  connect: (signal: AbortSignal) => Promise<Response>;
}

async function resolveTargets(
  workspaceIds: string[],
  userId: string,
): Promise<UpstreamTarget[]> {
  if (workspaceIds.length === 0) return [];

  const rows = await db
    .select()
    .from(workspaces)
    .where(
      and(inArray(workspaces.id, workspaceIds), eq(workspaces.userId, userId)),
    );

  return rows.map((row) => ({
    workspaceId: row.id,
    connect: async (signal: AbortSignal) => {
      const workspace = toWorkspace(row);
      const backend = getBackend(workspace);
      const serverUrl = await backend.getOpenCodeUrl();
      const eventUrl = new URL("/event", serverUrl);
      if (workspace.backend !== "remote") {
        eventUrl.searchParams.set("directory", workspace.path);
      }
      return fetch(eventUrl, {
        headers: { accept: "text/event-stream" },
        signal,
      });
    },
  }));
}

function safeEnqueue(
  controller: ReadableStreamDefaultController<Uint8Array>,
  chunk: Uint8Array,
  cancelled: { current: boolean },
) {
  if (cancelled.current) return;
  try {
    controller.enqueue(chunk);
  } catch {
    cancelled.current = true;
  }
}

function enqueueEvent(
  target: UpstreamTarget,
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  cancelled: { current: boolean },
  event: unknown,
): void {
  const wrapped = JSON.stringify({ workspaceId: target.workspaceId, event });
  safeEnqueue(controller, encoder.encode(`data: ${wrapped}\n\n`), cancelled);
}

function enqueueUpstreamData(
  target: UpstreamTarget,
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  cancelled: { current: boolean },
  data: string,
): void {
  try {
    enqueueEvent(target, controller, encoder, cancelled, JSON.parse(data));
  } catch {
    return;
  }
}

interface EngineEventStream {
  readonly stream: ReadableStream<Uint8Array>;
  readonly dispose: () => void;
}

const SSE_HEADERS = {
  "content-type": "text/event-stream",
  "cache-control": "no-cache",
  connection: "keep-alive",
  "x-accel-buffering": "no",
};

async function resolveOmoWorkspaces(
  workspaceIds: string[],
  userId: string,
): Promise<OmoRuntimeWorkspace[]> {
  const rows = await db
    .select()
    .from(workspaces)
    .where(
      and(inArray(workspaces.id, workspaceIds), eq(workspaces.userId, userId)),
    );
  return rows.map((row) => {
    const workspace = toWorkspace(row);
    return {
      id: workspace.id,
      path: workspace.path,
      backend: workspace.backend,
      agentUrl: workspace.agentUrl,
    };
  });
}

function createOpenCodeEventStream(
  targets: UpstreamTarget[],
  signal: AbortSignal,
): EngineEventStream {
  const encoder = new TextEncoder();
  const cancelled = { current: false };
  let streamController: ReadableStreamDefaultController<Uint8Array> | null =
    null;
  let isDisposed = false;

  function dispose(): void {
    if (isDisposed) return;
    isDisposed = true;
    cancelled.current = true;
    try {
      streamController?.close();
    } catch {
      // Stream already closed by cancel()
    }
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller;
      const upstreamPromises = targets.map((target) =>
        superviseSseTarget({
          signal,
          connect: target.connect,
          onData: (data) =>
            enqueueUpstreamData(target, controller, encoder, cancelled, data),
          onState: (state) =>
            enqueueEvent(target, controller, encoder, cancelled, {
              type: "workspace.connection",
              properties: state,
            }),
        }),
      );
      void Promise.allSettled(upstreamPromises).then(dispose);
    },
    cancel() {
      dispose();
    },
  });
  return { stream, dispose };
}

async function mixedEngineEvents(
  request: NextRequest,
  userId: string,
  openCodeWorkspaceIds: string[],
  omoWorkspaceIds: string[],
): Promise<Response> {
  const [targets, omoWorkspaces] = await Promise.all([
    resolveTargets(openCodeWorkspaceIds, userId),
    resolveOmoWorkspaces(omoWorkspaceIds, userId),
  ]);

  const abortController = new AbortController();
  const children: EngineEventStream[] = [];
  let isSettled = false;
  let isCancelled = false;
  const abortFromRequest = () => abortController.abort();
  request.signal.addEventListener("abort", abortFromRequest, { once: true });

  // Every exit path (outer cancel, child failure, normal settlement) funnels
  // here so each child is disposed exactly once.
  function settle(): void {
    if (isSettled) return;
    isSettled = true;
    request.signal.removeEventListener("abort", abortFromRequest);
    abortController.abort();
    for (const child of children) child.dispose();
  }

  let lastSetupError: unknown;
  try {
    if (targets.length > 0) {
      children.push(createOpenCodeEventStream(targets, abortController.signal));
    }
    const { createOmoWorkspaceEventStream } =
      await import("@/lib/omo/event-stream");
    const { createOmoContext } = await import("@/lib/omo/runtime");
    for (const workspace of omoWorkspaces) {
      // One unreachable or untrusted workspace must not take down the
      // shared stream for every other workspace.
      try {
        const { runtime } = createOmoContext(workspace);
        children.push(
          createOmoWorkspaceEventStream({
            workspace,
            runtime,
            signal: abortController.signal,
          }),
        );
      } catch (error) {
        lastSetupError = error;
        console.warn("[events] skipping OmO workspace", workspace.id, error);
      }
    }
  } catch (error) {
    lastSetupError = error;
  }
  if (children.length === 0) {
    settle();
    return NextResponse.json(
      {
        error: "Event stream unavailable",
        detail:
          lastSetupError instanceof Error
            ? lastSetupError.message
            : "Unknown error",
      },
      { status: 503 },
    );
  }

  const readers = children.map((child) => child.stream.getReader());
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const pumps = readers.map(async (reader) => {
        while (!isSettled) {
          const { done, value } = await reader.read();
          if (done || isSettled) return;
          try {
            controller.enqueue(value);
          } catch {
            settle();
          }
        }
      });
      for (const pump of pumps) void pump.catch(settle);
      void Promise.allSettled(pumps).then(() => {
        settle();
        if (isCancelled) return;
        try {
          controller.close();
        } catch {
          // Stream already closed by cancel()
        }
      });
    },
    cancel() {
      isCancelled = true;
      settle();
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const workspaceIdsParam = url.searchParams.get("workspaceIds");
  if (!workspaceIdsParam) {
    return NextResponse.json(
      { error: "workspaceIds query param required" },
      { status: 400 },
    );
  }

  const workspaceIds = workspaceIdsParam.split(",").filter(Boolean);
  const userId = session.user.id;
  const engines = await Promise.all(
    workspaceIds.map((workspaceId) =>
      resolveWorkspaceEngine(userId, workspaceId),
    ),
  );
  const omoWorkspaceIds = workspaceIds.filter(
    (_, index) => engines[index] === "omo",
  );
  if (omoWorkspaceIds.length > 0) {
    const openCodeWorkspaceIds = workspaceIds.filter(
      (_, index) => engines[index] !== "omo",
    );
    return mixedEngineEvents(
      request,
      userId,
      openCodeWorkspaceIds,
      omoWorkspaceIds,
    );
  }
  const targets = await resolveTargets(workspaceIds, session.user.id);

  const abortController = new AbortController();
  const encoder = new TextEncoder();
  const cancelled = { current: false };
  let keepalive: ReturnType<typeof setInterval> | null = null;
  const abortFromRequest = () => abortController.abort();
  request.signal.addEventListener("abort", abortFromRequest, { once: true });

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      keepalive = setInterval(() => {
        safeEnqueue(controller, encoder.encode(`: keepalive\n\n`), cancelled);
      }, KEEPALIVE_INTERVAL_MS);

      const upstreamPromises = targets.map((target) =>
        superviseSseTarget({
          signal: abortController.signal,
          connect: target.connect,
          onData: (data) =>
            enqueueUpstreamData(target, controller, encoder, cancelled, data),
          onState: (state) =>
            enqueueEvent(target, controller, encoder, cancelled, {
              type: "workspace.connection",
              properties: state,
            }),
        }),
      );

      Promise.allSettled(upstreamPromises).then(() => {
        if (keepalive !== null) clearInterval(keepalive);
        request.signal.removeEventListener("abort", abortFromRequest);
        if (!cancelled.current) {
          try {
            controller.close();
          } catch {
            // Stream already closed by cancel()
          }
        }
      });
    },
    cancel() {
      cancelled.current = true;
      if (keepalive !== null) clearInterval(keepalive);
      request.signal.removeEventListener("abort", abortFromRequest);
      abortController.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
