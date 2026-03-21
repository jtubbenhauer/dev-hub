import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { fileComments, workspaces } from "@/drizzle/schema";
import { eq, and } from "drizzle-orm";

// GET: list file comments for a workspace (optionally filtered by filePath)
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const workspaceId = url.searchParams.get("workspaceId");
  const filePath = url.searchParams.get("filePath");
  const includeResolved = url.searchParams.get("includeResolved") === "true";

  if (!workspaceId) {
    return NextResponse.json(
      { error: "workspaceId required" },
      { status: 400 },
    );
  }

  const [workspace] = await db
    .select()
    .from(workspaces)
    .where(
      and(
        eq(workspaces.id, workspaceId),
        eq(workspaces.userId, session.user.id),
      ),
    );

  if (!workspace) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  const conditions = [eq(fileComments.workspaceId, workspaceId)];

  if (filePath) {
    conditions.push(eq(fileComments.filePath, filePath));
  }

  if (!includeResolved) {
    conditions.push(eq(fileComments.resolved, false));
  }

  const rows = await db
    .select()
    .from(fileComments)
    .where(and(...conditions));

  return NextResponse.json(rows);
}

// POST: create a new file comment
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const {
    workspaceId,
    filePath,
    startLine,
    endLine,
    body: commentBody,
    contentSnapshot,
  } = body as {
    workspaceId: string;
    filePath: string;
    startLine: number;
    endLine: number;
    body: string;
    contentSnapshot?: string;
  };

  if (
    !workspaceId ||
    !filePath ||
    startLine == null ||
    endLine == null ||
    !commentBody
  ) {
    return NextResponse.json(
      {
        error:
          "workspaceId, filePath, startLine, endLine, and body are required",
      },
      { status: 400 },
    );
  }

  const [workspace] = await db
    .select()
    .from(workspaces)
    .where(
      and(
        eq(workspaces.id, workspaceId),
        eq(workspaces.userId, session.user.id),
      ),
    );

  if (!workspace) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  const now = new Date();
  const [created] = await db
    .insert(fileComments)
    .values({
      workspaceId,
      filePath,
      startLine,
      endLine,
      body: commentBody,
      contentSnapshot: contentSnapshot ?? null,
      resolved: false,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  return NextResponse.json(created, { status: 201 });
}
