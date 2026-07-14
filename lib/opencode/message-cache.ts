import { db } from "@/lib/db";
import { cachedMessages } from "@/drizzle/schema";
import { eq, and, notInArray, desc } from "drizzle-orm";
import type { MessageWithParts } from "@/lib/opencode/types";

export const MESSAGE_CACHE_FRESH_MS = 60_000;

// The cached_messages table is otherwise unbounded and had grown to ~740MB.
// Keep only the most-recently-cached sessions per user.
const MAX_CACHED_MESSAGE_ROWS_PER_USER = 200;

export interface CachedMessagesRow {
  messages: MessageWithParts[];
  cachedAt: number;
}

export async function readMessageCache(
  userId: string,
  sessionId: string,
  workspaceId: string,
): Promise<CachedMessagesRow | null> {
  const [row] = await db
    .select()
    .from(cachedMessages)
    .where(
      and(
        eq(cachedMessages.sessionId, sessionId),
        eq(cachedMessages.workspaceId, workspaceId),
        eq(cachedMessages.userId, userId),
      ),
    );

  if (!row) return null;

  try {
    const messages = JSON.parse(row.messagesJson) as MessageWithParts[];
    if (!Array.isArray(messages)) return null;
    return { messages, cachedAt: row.cachedAt };
  } catch {
    return null;
  }
}

export async function writeMessageCache(
  userId: string,
  sessionId: string,
  workspaceId: string,
  messages: MessageWithParts[],
): Promise<void> {
  const now = Date.now();
  const messagesJson = JSON.stringify(messages);

  await db
    .insert(cachedMessages)
    .values({ sessionId, workspaceId, userId, messagesJson, cachedAt: now })
    .onConflictDoUpdate({
      target: [cachedMessages.sessionId, cachedMessages.workspaceId],
      set: { messagesJson, cachedAt: now },
    });

  await pruneMessageCache(userId);
}

async function pruneMessageCache(userId: string): Promise<void> {
  const rows = await db
    .select({ sessionId: cachedMessages.sessionId })
    .from(cachedMessages)
    .where(eq(cachedMessages.userId, userId))
    .orderBy(desc(cachedMessages.cachedAt));

  if (rows.length <= MAX_CACHED_MESSAGE_ROWS_PER_USER) return;

  const survivors = rows
    .slice(0, MAX_CACHED_MESSAGE_ROWS_PER_USER)
    .map((row) => row.sessionId);

  await db
    .delete(cachedMessages)
    .where(
      and(
        eq(cachedMessages.userId, userId),
        notInArray(cachedMessages.sessionId, survivors),
      ),
    );
}
