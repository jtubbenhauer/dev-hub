import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { sessionNotes, workspaces } from "@/drizzle/schema";
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
    .select({
      sessionId: sessionNotes.sessionId,
      note: sessionNotes.note,
    })
    .from(sessionNotes)
    .where(eq(sessionNotes.workspaceId, id));

  const result: Record<string, string> = {};
  for (const row of rows) {
    result[row.sessionId] = row.note;
  }

  return NextResponse.json(result);
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();
  const { sessionId, note } = body as {
    sessionId?: string;
    note?: string;
  };

  if (!sessionId || typeof sessionId !== "string") {
    return NextResponse.json(
      { error: "sessionId is required" },
      { status: 400 },
    );
  }

  if (!note || typeof note !== "string" || note.trim().length === 0) {
    return NextResponse.json(
      { error: "note is required and must be non-empty" },
      { status: 400 },
    );
  }

  if (!(await verifyWorkspaceOwnership(id, session.user.id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await db
    .insert(sessionNotes)
    .values({ workspaceId: id, sessionId, note: note.trim() })
    .onConflictDoUpdate({
      target: [sessionNotes.workspaceId, sessionNotes.sessionId],
      set: { note: note.trim() },
    });

  return NextResponse.json({ saved: true });
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
    .delete(sessionNotes)
    .where(
      and(
        eq(sessionNotes.workspaceId, id),
        eq(sessionNotes.sessionId, sessionId),
      ),
    );

  return NextResponse.json({ deleted: true });
}
