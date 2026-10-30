import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import {
  endPtySession,
  setPtySessionPinned,
} from "@/lib/terminal/pty-admin-client";
import { isWorkspaceOwnedByUser } from "@/lib/terminal/terminal-workspace-access";

type RouteContext = {
  params: Promise<{ workspaceId: string; sessionId: string }>;
};

async function authorize(
  context: RouteContext,
): Promise<
  | { workspaceId: string; sessionId: string; response?: never }
  | { response: NextResponse }
> {
  const session = await auth();
  if (!session?.user?.id) {
    return {
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  const { workspaceId, sessionId } = await context.params;
  if (!(await isWorkspaceOwnedByUser(session.user.id, workspaceId))) {
    return {
      response: NextResponse.json(
        { error: "Workspace not found" },
        { status: 404 },
      ),
    };
  }
  return { workspaceId, sessionId };
}

function ptyUnavailable(err: unknown): NextResponse {
  return NextResponse.json(
    {
      error: err instanceof Error ? err.message : "PTY server is not reachable",
    },
    { status: 502 },
  );
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const access = await authorize(context);
  if (access.response) return access.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const isPinned = (body as { isPinned?: unknown }).isPinned;
  if (typeof isPinned !== "boolean") {
    return NextResponse.json(
      { error: "isPinned must be a boolean" },
      { status: 400 },
    );
  }

  try {
    const terminal = await setPtySessionPinned(
      access.workspaceId,
      access.sessionId,
      isPinned,
    );
    if (!terminal) {
      return NextResponse.json(
        { error: "Terminal session not found" },
        { status: 404 },
      );
    }
    return NextResponse.json({ session: terminal });
  } catch (err) {
    return ptyUnavailable(err);
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  const access = await authorize(context);
  if (access.response) return access.response;

  try {
    const hasEnded = await endPtySession(access.workspaceId, access.sessionId);
    return NextResponse.json({ ended: hasEnded });
  } catch (err) {
    return ptyUnavailable(err);
  }
}
