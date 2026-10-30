import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import {
  createTerminalToken,
  TERMINAL_SOCKET_TOKEN_TTL_MS,
  terminalSocketScope,
} from "@/lib/terminal/terminal-auth";
import { isWorkspaceOwnedByUser } from "@/lib/terminal/terminal-workspace-access";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workspaceId = request.nextUrl.searchParams.get("workspaceId");
  if (!workspaceId) {
    return NextResponse.json(
      { error: "workspaceId is required" },
      { status: 400 },
    );
  }

  if (!(await isWorkspaceOwnedByUser(session.user.id, workspaceId))) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  return NextResponse.json(
    {
      token: createTerminalToken(
        terminalSocketScope(workspaceId),
        TERMINAL_SOCKET_TOKEN_TTL_MS,
      ),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
