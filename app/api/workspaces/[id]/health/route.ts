import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { workspaces } from "@/drizzle/schema";
import { eq, and } from "drizzle-orm";
import { toWorkspace } from "@/lib/workspaces/backend";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const [row] = await db
    .select()
    .from(workspaces)
    .where(and(eq(workspaces.id, id), eq(workspaces.userId, session.user.id)));

  if (!row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const workspace = toWorkspace(row);

  if (workspace.backend !== "remote") {
    return NextResponse.json({ status: "ok", backend: "local" });
  }

  if (!workspace.agentUrl) {
    return NextResponse.json({
      status: "unreachable",
      reason: "No agent URL configured",
    });
  }

  try {
    const response = await globalThis.fetch(
      new URL("/health", workspace.agentUrl).toString(),
      { signal: AbortSignal.timeout(5000) },
    );
    if (!response.ok) {
      return NextResponse.json({
        status: "unreachable",
        reason: `Agent returned ${response.status}`,
      });
    }
    const body = (await response.json()) as {
      status?: string;
      workspacePath?: string;
    };
    if (body.status === "ok") {
      return NextResponse.json({
        status: "ok",
        backend: "remote",
        workspacePath: body.workspacePath,
      });
    }
    return NextResponse.json({
      status: "unreachable",
      reason: "Agent returned unexpected status",
    });
  } catch {
    return NextResponse.json({
      status: "unreachable",
      reason: "Cannot reach agent",
    });
  }
}
