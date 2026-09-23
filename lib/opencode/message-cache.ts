import { db } from "@/lib/db";
import { cachedMessages } from "@/drizzle/schema";
import { eq, and, desc } from "drizzle-orm";
import type { MessageWithParts } from "@/lib/opencode/types";
import { isMessageWithParts } from "@/lib/opencode/message-validation";

export const MESSAGE_CACHE_FRESH_MS = 60_000;

// The cached_messages table is otherwise unbounded and had grown to ~740MB.
// Keep only the most-recently-cached sessions per user.
const MAX_CACHED_MESSAGE_ROWS_PER_USER = 200;

export interface CachedMessagesRow {
  messages: MessageWithParts[];
  authoritativeMessageIds: string[];
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
    const messages: unknown = JSON.parse(row.messagesJson);
    const authoritativeMessageIds: unknown = JSON.parse(
      row.authoritativeMessageIdsJson,
    );
    if (!Array.isArray(messages) || !messages.every(isMessageWithParts)) {
      return null;
    }
    if (
      !Array.isArray(authoritativeMessageIds) ||
      !authoritativeMessageIds.every((id) => typeof id === "string")
    ) {
      return null;
    }
    return { messages, authoritativeMessageIds, cachedAt: row.cachedAt };
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

interface MessageCacheWrite {
  readonly userId: string;
  readonly sessionId: string;
  readonly workspaceId: string;
  readonly messages: MessageWithParts[];
  readonly authoritativeMessageIds: string[];
}

export async function writeMessageCache({
  userId,
  sessionId,
  workspaceId,
  messages,
  authoritativeMessageIds,
}: MessageCacheWrite): Promise<void> {
  const now = Date.now();
  const messagesJson = JSON.stringify(messages);
  const authoritativeMessageIdsJson = JSON.stringify(authoritativeMessageIds);

  await db
    .insert(cachedMessages)
    .values({
      sessionId,
      workspaceId,
      userId,
      messagesJson,
      authoritativeMessageIdsJson,
      cachedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        cachedMessages.userId,
        cachedMessages.workspaceId,
        cachedMessages.sessionId,
      ],
      set: { messagesJson, authoritativeMessageIdsJson, cachedAt: now },
    });

  await pruneMessageCache(userId);
}

async function pruneMessageCache(userId: string): Promise<void> {
  const rows = await db
    .select({
      sessionId: cachedMessages.sessionId,
      workspaceId: cachedMessages.workspaceId,
    })
    .from(cachedMessages)
    .where(eq(cachedMessages.userId, userId))
    .orderBy(desc(cachedMessages.cachedAt));

  if (rows.length <= MAX_CACHED_MESSAGE_ROWS_PER_USER) return;

  db.transaction((transaction) => {
    for (const row of rows.slice(MAX_CACHED_MESSAGE_ROWS_PER_USER)) {
      transaction
        .delete(cachedMessages)
        .where(
          and(
            eq(cachedMessages.userId, userId),
            eq(cachedMessages.workspaceId, row.workspaceId),
            eq(cachedMessages.sessionId, row.sessionId),
          ),
        )
        .run();
    }
  });
}

interface MessageCachePurge {
  readonly userId: string;
  readonly workspaceId: string;
  readonly sessionId: string;
  readonly fromMessageId?: string;
  readonly exactMessageId?: string;
}

export async function purgeMessageCache({
  userId,
  workspaceId,
  sessionId,
  fromMessageId,
  exactMessageId,
}: MessageCachePurge): Promise<void> {
  const scope = and(
    eq(cachedMessages.userId, userId),
    eq(cachedMessages.workspaceId, workspaceId),
    eq(cachedMessages.sessionId, sessionId),
  );
  if (fromMessageId === undefined) {
    if (exactMessageId !== undefined) {
      const cached = await readMessageCache(userId, sessionId, workspaceId);
      if (cached === null) return;
      await db
        .update(cachedMessages)
        .set({
          messagesJson: JSON.stringify(
            cached.messages.filter(
              (message) => message.info.id !== exactMessageId,
            ),
          ),
          authoritativeMessageIdsJson: JSON.stringify(
            cached.authoritativeMessageIds.filter(
              (messageId) => messageId !== exactMessageId,
            ),
          ),
          cachedAt: Date.now(),
        })
        .where(scope);
      return;
    }
    await db.delete(cachedMessages).where(scope);
    return;
  }

  const cached = await readMessageCache(userId, sessionId, workspaceId);
  const anchorIndex = cached?.messages.findIndex(
    (message) => message.info.id === fromMessageId,
  );
  if (cached === null || anchorIndex === undefined || anchorIndex < 0) return;
  const retainedMessages = cached.messages.slice(0, anchorIndex);
  const retainedIds = new Set(
    retainedMessages.map((message) => message.info.id),
  );

  await db
    .update(cachedMessages)
    .set({
      messagesJson: JSON.stringify(retainedMessages),
      authoritativeMessageIdsJson: JSON.stringify(
        cached.authoritativeMessageIds.filter((messageId) =>
          retainedIds.has(messageId),
        ),
      ),
      cachedAt: Date.now(),
    })
    .where(scope);
}
