import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { listPtySessions } from "@/lib/terminal/pty-admin-client";
import { listOwnedWorkspaceIds } from "@/lib/terminal/terminal-workspace-access";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workspaceId = request.nextUrl.searchParams.get("workspaceId");
  const ownedWorkspaceIds = await listOwnedWorkspaceIds(session.user.id);

  try {
    const sessions = (await listPtySessions()).filter(
      (terminal) =>
        terminal.kind === "shell" &&
        ownedWorkspaceIds.has(terminal.workspaceId) &&
        (!workspaceId || terminal.workspaceId === workspaceId),
    );
    return NextResponse.json({ sessions, now: Date.now() });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "PTY server is not reachable",
      },
      { status: 502 },
    );
  }
}
