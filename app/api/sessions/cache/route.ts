import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db";
import {
  cachedSessions,
  cachedMessages,
  recoveredMessages,
} from "@/drizzle/schema";
import { eq, and } from "drizzle-orm";
import {
  OpenCodeTargetError,
  resolveOpenCodeTarget,
} from "@/lib/opencode/proxy-target";

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

const MAX_SESSION_CACHE_SYNC = 5_500;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isIncomingSession(value: unknown): value is IncomingSession {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    isRecord(value.time) &&
    typeof value.time.created === "number" &&
    Number.isFinite(value.time.created) &&
    typeof value.time.updated === "number" &&
    Number.isFinite(value.time.updated) &&
    (value.title === undefined || typeof value.title === "string") &&
    (value.parentID === undefined || typeof value.parentID === "string") &&
    (value.status === undefined || typeof value.status === "string")
  );
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  if (
    !isRecord(body) ||
    typeof body.workspaceId !== "string" ||
    !Array.isArray(body.sessions) ||
    !body.sessions.every(isIncomingSession)
  ) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  if (body.sessions.length > MAX_SESSION_CACHE_SYNC) {
    return NextResponse.json(
      { error: "Too many sessions in one sync" },
      { status: 413 },
    );
  }

  try {
    await resolveOpenCodeTarget(session.user.id, body.workspaceId);
  } catch (error) {
    if (error instanceof OpenCodeTargetError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    throw error;
  }

  const now = Date.now();
  const userId = session.user.id;
  const { workspaceId, sessions: incoming } = body;
  const forcePrune = body.force === true;

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
          target: [
            cachedSessions.userId,
            cachedSessions.workspaceId,
            cachedSessions.id,
          ],
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

    if (incoming.length === 0 && forcePrune) {
      tx.delete(cachedSessions)
        .where(
          and(
            eq(cachedSessions.workspaceId, workspaceId),
            eq(cachedSessions.userId, userId),
          ),
        )
        .run();

      tx.delete(cachedMessages)
        .where(
          and(
            eq(cachedMessages.workspaceId, workspaceId),
            eq(cachedMessages.userId, userId),
          ),
        )
        .run();

      tx.delete(recoveredMessages)
        .where(
          and(
            eq(recoveredMessages.workspaceId, workspaceId),
            eq(recoveredMessages.userId, userId),
          ),
        )
        .run();
    }
    // Session lists are capped and remote workspaces can disappear temporarily,
    // so omission never proves deletion. Only an explicit force clear prunes
    // durable session metadata or message history.
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const workspaceId = url.searchParams.get("workspaceId");
  const sessionId = url.searchParams.get("sessionId");
  if (!workspaceId || !sessionId) {
    return NextResponse.json(
      { error: "workspaceId and sessionId are required" },
      { status: 400 },
    );
  }

  try {
    await resolveOpenCodeTarget(session.user.id, workspaceId);
  } catch (error) {
    if (error instanceof OpenCodeTargetError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    throw error;
  }

  const userId = session.user.id;
  db.transaction((transaction) => {
    transaction
      .delete(cachedSessions)
      .where(
        and(
          eq(cachedSessions.userId, userId),
          eq(cachedSessions.workspaceId, workspaceId),
          eq(cachedSessions.id, sessionId),
        ),
      )
      .run();
    transaction
      .delete(cachedMessages)
      .where(
        and(
          eq(cachedMessages.userId, userId),
          eq(cachedMessages.workspaceId, workspaceId),
          eq(cachedMessages.sessionId, sessionId),
        ),
      )
      .run();
    transaction
      .delete(recoveredMessages)
      .where(
        and(
          eq(recoveredMessages.userId, userId),
          eq(recoveredMessages.workspaceId, workspaceId),
          eq(recoveredMessages.sessionId, sessionId),
        ),
      )
      .run();
  });

  return NextResponse.json({ deleted: true });
}
