import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { cachedSessions } from "@/drizzle/schema";
import { eq, and, notInArray } from "drizzle-orm";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const workspaceId = url.searchParams.get("workspaceId");

  const conditions = [eq(cachedSessions.userId, session.user.id)];
  if (workspaceId) {
    conditions.push(eq(cachedSessions.workspaceId, workspaceId));
  }

  const rows = await db
    .select()
    .from(cachedSessions)
    .where(and(...conditions));

  const result = rows.map((row) => ({
    id: row.id,
    title: row.title,
    parentID: row.parentId,
    time: {
      created: row.createdAt,
      updated: row.updatedAt,
    },
    fromCache: true,
  }));

  return NextResponse.json(result);
}

interface IncomingSession {
  id: string;
  title?: string;
  parentID?: string;
  time: { created: number; updated: number };
  status?: string;
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as {
    workspaceId: string;
    sessions: IncomingSession[];
  };

  if (!body.workspaceId || !Array.isArray(body.sessions)) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const now = Date.now();
  const userId = session.user.id;
  const { workspaceId, sessions: incoming } = body;

  // Single transaction: turns N individual fsync'd writes into one
  db.transaction((tx) => {
    for (const s of incoming) {
      tx.insert(cachedSessions)
        .values({
          id: s.id,
          workspaceId,
          userId,
          title: s.title ?? null,
          parentId: s.parentID ?? null,
          status: s.status ?? null,
          createdAt: s.time.created,
          updatedAt: s.time.updated,
          cachedAt: now,
        })
        .onConflictDoUpdate({
          target: cachedSessions.id,
          set: {
            title: s.title ?? null,
            parentId: s.parentID ?? null,
            status: s.status ?? null,
            createdAt: s.time.created,
            updatedAt: s.time.updated,
            cachedAt: now,
          },
        })
        .run();
    }

    const incomingIds = incoming.map((s) => s.id);
    if (incomingIds.length > 0) {
      tx.delete(cachedSessions)
        .where(
          and(
            eq(cachedSessions.workspaceId, workspaceId),
            eq(cachedSessions.userId, userId),
            notInArray(cachedSessions.id, incomingIds),
          ),
        )
        .run();
    } else {
      tx.delete(cachedSessions)
        .where(
          and(
            eq(cachedSessions.workspaceId, workspaceId),
            eq(cachedSessions.userId, userId),
          ),
        )
        .run();
    }
  });

  return NextResponse.json({ ok: true });
}
