import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { pinnedSessions, workspaces } from "@/drizzle/schema";
import { eq, and } from "drizzle-orm";

interface RouteParams {
  params: Promise<{ id: string }>;
}

async function verifyWorkspaceOwnership(workspaceId: string, userId: string) {
  const [workspace] = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(and(eq(workspaces.id, workspaceId), eq(workspaces.userId, userId)));
  return workspace ?? null;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!(await verifyWorkspaceOwnership(id, session.user.id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const rows = await db
    .select({ sessionId: pinnedSessions.sessionId })
    .from(pinnedSessions)
    .where(eq(pinnedSessions.workspaceId, id));

  return NextResponse.json(rows.map((r) => r.sessionId));
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();
  const { sessionId } = body as { sessionId?: string };

  if (!sessionId || typeof sessionId !== "string") {
    return NextResponse.json(
      { error: "sessionId is required" },
      { status: 400 },
    );
  }

  if (!(await verifyWorkspaceOwnership(id, session.user.id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await db
    .insert(pinnedSessions)
    .values({ workspaceId: id, sessionId })
    .onConflictDoNothing();

  return NextResponse.json({ pinned: true });
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const url = new URL(request.url);
  const sessionId = url.searchParams.get("sessionId");

  if (!sessionId) {
    return NextResponse.json(
      { error: "sessionId query param is required" },
      { status: 400 },
    );
  }

  if (!(await verifyWorkspaceOwnership(id, session.user.id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await db
    .delete(pinnedSessions)
    .where(
      and(
        eq(pinnedSessions.workspaceId, id),
        eq(pinnedSessions.sessionId, sessionId),
      ),
    );

  return NextResponse.json({ unpinned: true });
}
