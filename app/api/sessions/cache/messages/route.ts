import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { cachedMessages } from "@/drizzle/schema";
import { eq, and } from "drizzle-orm";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const sessionId = url.searchParams.get("sessionId");
  const workspaceId = url.searchParams.get("workspaceId");

  if (!sessionId || !workspaceId) {
    return NextResponse.json(
      { error: "sessionId and workspaceId are required" },
      { status: 400 },
    );
  }

  const [row] = await db
    .select()
    .from(cachedMessages)
    .where(
      and(
        eq(cachedMessages.sessionId, sessionId),
        eq(cachedMessages.workspaceId, workspaceId),
        eq(cachedMessages.userId, session.user.id),
      ),
    );

  if (!row) {
    return NextResponse.json(null);
  }

  try {
    const messages = JSON.parse(row.messagesJson);
    return NextResponse.json({ messages, cachedAt: row.cachedAt });
  } catch {
    return NextResponse.json(null);
  }
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as {
    sessionId: string;
    workspaceId: string;
    messages: unknown[];
  };

  if (!body.sessionId || !body.workspaceId || !Array.isArray(body.messages)) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const now = Date.now();

  await db
    .insert(cachedMessages)
    .values({
      sessionId: body.sessionId,
      workspaceId: body.workspaceId,
      userId: session.user.id,
      messagesJson: JSON.stringify(body.messages),
      cachedAt: now,
    })
    .onConflictDoUpdate({
      target: [cachedMessages.sessionId, cachedMessages.workspaceId],
      set: {
        messagesJson: JSON.stringify(body.messages),
        cachedAt: now,
      },
    });

  return NextResponse.json({ ok: true });
}
