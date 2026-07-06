import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { workspaces } from "@/drizzle/schema";
import { eq, and } from "drizzle-orm";
import { toWorkspace } from "@/lib/workspaces/backend";

const RESTART_COMMAND = "pkill -TERM -f '[o]pencode serve' || true";

async function restartViaCommandApi(agentUrl: string): Promise<Response> {
  const commandResponse = await fetch(
    new URL("/commands/run", agentUrl).toString(),
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ command: RESTART_COMMAND }),
      signal: AbortSignal.timeout(10_000),
    },
  );

  if (!commandResponse.ok) {
    const detail = await commandResponse.text().catch(() => "");
    return NextResponse.json(
      {
        error: "Agent restart failed",
        detail: detail || `Command fallback HTTP ${commandResponse.status}`,
      },
      { status: 502 },
    );
  }

  const streamText = await commandResponse.text().catch(() => "");
  const hasFailedExit = streamText.includes('"exitCode":1');
  if (hasFailedExit) {
    return NextResponse.json(
      {
        error: "Agent restart failed",
        detail: "Command fallback exited with code 1",
      },
      { status: 502 },
    );
  }

  return NextResponse.json({
    restarted: true,
    target: "remote",
    killedCount: null,
    fallback: "commands/run",
  });
}

export async function POST(request: NextRequest): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const workspaceId = url.searchParams.get("workspaceId");

  if (!workspaceId) {
    const { stopServer } = await import("@/lib/opencode/server-pool");
    stopServer();
    return NextResponse.json({ restarted: true, target: "local" });
  }

  const [row] = await db
    .select()
    .from(workspaces)
    .where(
      and(
        eq(workspaces.id, workspaceId),
        eq(workspaces.userId, session.user.id),
      ),
    );

  if (!row) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  const workspace = toWorkspace(row);

  if (workspace.backend !== "remote") {
    const { stopServer } = await import("@/lib/opencode/server-pool");
    stopServer();
    return NextResponse.json({ restarted: true, target: "local" });
  }

  if (!workspace.agentUrl) {
    return NextResponse.json(
      { error: "Remote workspace has no agent URL" },
      { status: 400 },
    );
  }

  try {
    const agentResponse = await fetch(
      new URL("/opencode/restart", workspace.agentUrl).toString(),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(10_000),
      },
    );

    if (!agentResponse.ok) {
      if (agentResponse.status === 404) {
        return await restartViaCommandApi(workspace.agentUrl);
      }

      const detail = await agentResponse.text().catch(() => "");
      return NextResponse.json(
        {
          error: "Agent restart failed",
          detail: detail || `HTTP ${agentResponse.status}`,
        },
        { status: 502 },
      );
    }

    const data = (await agentResponse.json().catch(() => ({}))) as {
      restarted?: boolean;
      killedCount?: number;
    };

    return NextResponse.json({
      restarted: true,
      target: "remote",
      killedCount: data.killedCount ?? 0,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to reach agent for restart";
    return NextResponse.json(
      { error: "Agent unreachable", detail: message },
      { status: 502 },
    );
  }
}
