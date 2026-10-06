import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { workspaces } from "@/drizzle/schema";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db";
import {
  getLspServerManager,
  LspBusyError,
  type LspServerManager,
} from "@/lib/lsp/server-manager";
import type { LspControlRequest, LspErrorCode } from "@/lib/lsp/types";
import { ensureLspWsServer } from "@/lib/lsp/ws-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type WorkspaceLookup =
  | { readonly workspacePath: string }
  | { readonly errorResponse: NextResponse };

type PortLookup =
  | { readonly port: number }
  | { readonly errorResponse: NextResponse };

function errorResponse(status: number, error: string, code?: LspErrorCode) {
  return NextResponse.json(code ? { error, code } : { error }, { status });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isLspControlRequest(value: unknown): value is LspControlRequest {
  if (typeof value !== "object" || value === null) return false;
  const action: unknown = Reflect.get(value, "action");
  const workspaceId: unknown = Reflect.get(value, "workspaceId");
  return (
    (action === "start" || action === "stop") &&
    typeof workspaceId === "string" &&
    workspaceId.length > 0
  );
}

async function findLocalWorkspace(
  workspaceId: string,
  userId: string,
): Promise<WorkspaceLookup> {
  const [workspace] = await db
    .select()
    .from(workspaces)
    .where(and(eq(workspaces.id, workspaceId), eq(workspaces.userId, userId)));
  if (!workspace) {
    return {
      errorResponse: errorResponse(404, "Workspace not found", "NOT_FOUND"),
    };
  }
  if (workspace.backend !== "local") {
    return {
      errorResponse: errorResponse(
        400,
        "LSP is only available for local workspaces",
        "REMOTE_WORKSPACE",
      ),
    };
  }
  return { workspacePath: workspace.path };
}

async function ensurePort(manager: LspServerManager): Promise<PortLookup> {
  try {
    return await ensureLspWsServer(manager);
  } catch (error) {
    return {
      errorResponse: errorResponse(
        500,
        errorMessage(error),
        "LSP_PORT_UNAVAILABLE",
      ),
    };
  }
}

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return errorResponse(401, "Unauthorized", "UNAUTHORIZED");
  }
  const workspaceId = request.nextUrl.searchParams.get("workspaceId");
  if (!workspaceId) {
    return errorResponse(400, "workspaceId is required", "INVALID_REQUEST");
  }
  const workspace = await findLocalWorkspace(workspaceId, session.user.id);
  if ("errorResponse" in workspace) return workspace.errorResponse;

  const manager = getLspServerManager();
  const portLookup = await ensurePort(manager);
  if ("errorResponse" in portLookup) return portLookup.errorResponse;
  return NextResponse.json(manager.getStatus(workspaceId, portLookup.port));
}

async function startLsp(workspaceId: string, workspacePath: string) {
  const manager = getLspServerManager();
  const portLookup = await ensurePort(manager);
  if ("errorResponse" in portLookup) return portLookup.errorResponse;
  try {
    await manager.start({ workspaceId, workspacePath });
  } catch (error) {
    if (error instanceof LspBusyError) {
      return errorResponse(409, "LSP is in use by another session", "LSP_BUSY");
    }
    return errorResponse(500, errorMessage(error));
  }
  return NextResponse.json(manager.getStatus(workspaceId, portLookup.port));
}

async function stopLsp(workspaceId: string) {
  const manager = getLspServerManager();
  if (manager.workspaceId === workspaceId) {
    try {
      await manager.stop();
    } catch (error) {
      return errorResponse(500, errorMessage(error));
    }
  }
  // Stopped state never carries a wsUrl, so the port is irrelevant here.
  return NextResponse.json(manager.getStatus(workspaceId, 0));
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return errorResponse(401, "Unauthorized", "UNAUTHORIZED");
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "Invalid JSON body", "INVALID_REQUEST");
  }
  if (!isLspControlRequest(body)) {
    return errorResponse(
      400,
      "Expected { action: 'start' | 'stop', workspaceId }",
      "INVALID_REQUEST",
    );
  }
  const workspace = await findLocalWorkspace(body.workspaceId, session.user.id);
  if ("errorResponse" in workspace) return workspace.errorResponse;

  switch (body.action) {
    case "start":
      return startLsp(body.workspaceId, workspace.workspacePath);
    case "stop":
      return stopLsp(body.workspaceId);
  }
}
