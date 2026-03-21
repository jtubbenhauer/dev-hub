import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { workspaces, commandHistory } from "@/drizzle/schema";
import { eq, and } from "drizzle-orm";
import {
  spawnProcess,
  subscribe,
  getOutputBuffer,
  getProcess,
} from "@/lib/commands/process-manager";
import { toWorkspace } from "@/lib/workspaces/backend";
import type { RunCommandRequest } from "@/lib/commands/types";

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: RunCommandRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { command, workspaceId } = body;
  if (!command || !workspaceId) {
    return NextResponse.json(
      { error: "command and workspaceId are required" },
      { status: 400 },
    );
  }

  const [row] = await db
    .select()
    .from(workspaces)
    .where(
      and(
        eq(workspaces.id, workspaceId),
        eq(workspaces.userId, session.user.id),
      ),
    )
    .limit(1);

  if (!row) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  const workspace = toWorkspace(row);

  if (workspace.backend === "remote") {
    return proxyRemoteRun(workspace.agentUrl!, command, workspaceId);
  }

  return runLocalCommand(request, command, workspaceId, workspace.path);
}

function runLocalCommand(
  request: NextRequest,
  command: string,
  workspaceId: string,
  workspacePath: string,
): Response {
  const sessionId = crypto.randomUUID();

  spawnProcess(sessionId, command, workspacePath, workspaceId);

  const managed = getProcess(sessionId);
  if (!managed) {
    return NextResponse.json(
      { error: "Failed to spawn process" },
      { status: 500 },
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          `event: session\ndata: ${JSON.stringify({ sessionId })}\n\n`,
        ),
      );

      const buffer = getOutputBuffer(sessionId);
      for (const chunk of buffer) {
        controller.enqueue(
          encoder.encode(
            `event: data\ndata: ${JSON.stringify({ data: chunk })}\n\n`,
          ),
        );
      }

      if (managed.exited) {
        controller.enqueue(
          encoder.encode(
            `event: exit\ndata: ${JSON.stringify({ exitCode: managed.exitCode })}\n\n`,
          ),
        );
        controller.close();
        return;
      }

      const unsubscribe = subscribe(sessionId, (event) => {
        try {
          controller.enqueue(encoder.encode(event));

          if (
            event.startsWith("event: exit") ||
            event.startsWith("event: error")
          ) {
            recordToHistory(workspaceId, command, managed.exitCode);
            unsubscribe?.();
            controller.close();
          }
        } catch {
          unsubscribe?.();
        }
      });

      request.signal.addEventListener("abort", () => {
        unsubscribe?.();
      });
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      "x-session-id": sessionId,
    },
  });
}

async function proxyRemoteRun(
  agentUrl: string,
  command: string,
  workspaceId: string,
): Promise<Response> {
  const url = new URL("/commands/run", agentUrl);

  const agentResponse = await globalThis.fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ command }),
  });

  if (!agentResponse.ok) {
    const text = await agentResponse.text();
    return NextResponse.json(
      { error: `Agent error: ${text}` },
      { status: agentResponse.status },
    );
  }

  if (!agentResponse.body) {
    return NextResponse.json(
      { error: "Agent returned no stream body" },
      { status: 502 },
    );
  }

  // Pipe the SSE stream through, recording history when done
  const agentBody = agentResponse.body;
  let lastExitCode: number | null = null;

  const transformStream = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      controller.enqueue(chunk);

      // Try to detect exit events for history recording
      const text = new TextDecoder().decode(chunk);
      const exitMatch = text.match(/"exitCode"\s*:\s*(-?\d+|null)/);
      if (exitMatch) {
        lastExitCode =
          exitMatch[1] === "null" ? null : parseInt(exitMatch[1], 10);
      }
    },
    flush() {
      recordToHistory(workspaceId, command, lastExitCode);
    },
  });

  const proxiedStream = agentBody.pipeThrough(transformStream);

  return new Response(proxiedStream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
}

async function recordToHistory(
  workspaceId: string,
  command: string,
  exitCode: number | null,
): Promise<void> {
  try {
    await db.insert(commandHistory).values({ workspaceId, command, exitCode });
  } catch (err) {
    console.error("[commands/run] Failed to record command history:", err);
  }
}

export const maxDuration = 300;
