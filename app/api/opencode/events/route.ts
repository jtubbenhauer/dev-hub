import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { workspaces } from "@/drizzle/schema";
import { eq, and, inArray } from "drizzle-orm";
import { getBackend, toWorkspace } from "@/lib/workspaces/backend";
import { superviseSseTarget } from "@/lib/opencode/sse-supervisor";

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
