import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { workspaces } from "@/drizzle/schema";
import { eq, and } from "drizzle-orm";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const [workspace] = await db
    .select({ worktreeSymlinks: workspaces.worktreeSymlinks })
    .from(workspaces)
    .where(and(eq(workspaces.id, id), eq(workspaces.userId, session.user.id)));

  if (!workspace) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ symlinkPaths: workspace.worktreeSymlinks ?? [] });
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();
  const { symlinkPaths } = body;

  if (
    !Array.isArray(symlinkPaths) ||
    !symlinkPaths.every((p: unknown) => typeof p === "string")
  ) {
    return NextResponse.json(
      { error: "symlinkPaths must be an array of strings" },
      { status: 400 },
    );
  }

  const [workspace] = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(and(eq(workspaces.id, id), eq(workspaces.userId, session.user.id)));

  if (!workspace) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await db
    .update(workspaces)
    .set({ worktreeSymlinks: symlinkPaths.length > 0 ? symlinkPaths : null })
    .where(eq(workspaces.id, id));

  return NextResponse.json({ symlinkPaths });
}
