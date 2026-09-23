import { and, asc, eq, gte, sql } from "drizzle-orm";
import { recoveredMessages } from "@/drizzle/schema";
import { db } from "@/lib/db";
import type { RecoveredMessageEntry } from "@/lib/opencode/merge-messages";
import { isMessageWithParts } from "@/lib/opencode/message-validation";
import type { MessageWithParts } from "@/lib/opencode/types";

export const MAX_ARCHIVED_MESSAGES_PER_SESSION = 50_000;
const MAX_ARCHIVED_MESSAGE_BYTES = 2 * 1024 * 1024;
const MAX_ARCHIVED_SESSION_BYTES = 256 * 1024 * 1024;

export async function readRecoveredMessages(
  userId: string,
  workspaceId: string,
  sessionId: string,
): Promise<RecoveredMessageEntry[]> {
  const rows = await db
    .select({
      sessionId: recoveredMessages.sessionId,
      messageId: recoveredMessages.messageId,
      sequence: recoveredMessages.sequence,
      messageJson: recoveredMessages.messageJson,
    })
    .from(recoveredMessages)
    .where(
      and(
        eq(recoveredMessages.userId, userId),
        eq(recoveredMessages.workspaceId, workspaceId),
        eq(recoveredMessages.sessionId, sessionId),
      ),
    )
    .orderBy(asc(recoveredMessages.sequence), asc(recoveredMessages.messageId))
    .limit(MAX_ARCHIVED_MESSAGES_PER_SESSION);

  const entries: RecoveredMessageEntry[] = [];
  for (const row of rows) {
    let message: unknown;
    try {
      message = JSON.parse(row.messageJson);
    } catch (error) {
      if (error instanceof SyntaxError) continue;
      throw error;
    }
    if (
      isMessageWithParts(message) &&
      message.info.sessionID === row.sessionId &&
      message.info.id === row.messageId
    ) {
      entries.push({ sequence: row.sequence, message });
    }
  }
  return entries;
}

interface RecoveredMessageWrite {
  readonly userId: string;
  readonly workspaceId: string;
  readonly sessionId: string;
  readonly messages: readonly MessageWithParts[];
}

export async function writeRecoveredMessages({
  userId,
  workspaceId,
  sessionId,
  messages,
}: RecoveredMessageWrite): Promise<void> {
  const recoveredAt = Date.now();
  const archivable: Array<{
    message: MessageWithParts;
    messageJson: string;
  }> = [];
  let archivedBytes = 0;
  for (const message of messages.slice(0, MAX_ARCHIVED_MESSAGES_PER_SESSION)) {
    if (
      message.info.sessionID !== sessionId ||
      message.info.id.startsWith("optimistic-")
    ) {
      continue;
    }
    const messageJson = JSON.stringify(message);
    const messageBytes = Buffer.byteLength(messageJson);
    if (messageBytes > MAX_ARCHIVED_MESSAGE_BYTES) continue;
    if (archivedBytes + messageBytes > MAX_ARCHIVED_SESSION_BYTES) break;
    archivedBytes += messageBytes;
    archivable.push({ message, messageJson });
  }
  if (archivable.length === 0) return;

  db.transaction((transaction) => {
    for (const { message, messageJson } of archivable) {
      transaction
        .insert(recoveredMessages)
        .values({
          userId,
          workspaceId,
          sessionId,
          messageId: message.info.id,
          sequence: message.info.time.created,
          messageJson,
          recoveredAt,
        })
        .onConflictDoUpdate({
          target: [
            recoveredMessages.userId,
            recoveredMessages.workspaceId,
            recoveredMessages.sessionId,
            recoveredMessages.messageId,
          ],
          set: { messageJson, recoveredAt },
          setWhere: sql`excluded.message_json <> ${recoveredMessages.messageJson}`,
        })
        .run();
    }
  });
}

interface RecoveredMessagePurge {
  readonly userId: string;
  readonly workspaceId: string;
  readonly sessionId: string;
  readonly fromMessageId?: string;
  readonly exactMessageId?: string;
}

export async function purgeRecoveredMessages({
  userId,
  workspaceId,
  sessionId,
  fromMessageId,
  exactMessageId,
}: RecoveredMessagePurge): Promise<number> {
  const scope = and(
    eq(recoveredMessages.userId, userId),
    eq(recoveredMessages.workspaceId, workspaceId),
    eq(recoveredMessages.sessionId, sessionId),
  );

  if (exactMessageId !== undefined) {
    return db
      .delete(recoveredMessages)
      .where(and(scope, eq(recoveredMessages.messageId, exactMessageId)))
      .run().changes;
  }

  if (fromMessageId === undefined) {
    return db.delete(recoveredMessages).where(scope).run().changes;
  }

  const [anchor] = await db
    .select({ sequence: recoveredMessages.sequence })
    .from(recoveredMessages)
    .where(and(scope, eq(recoveredMessages.messageId, fromMessageId)))
    .limit(1);
  if (!anchor) return 0;

  return db
    .delete(recoveredMessages)
    .where(and(scope, gte(recoveredMessages.sequence, anchor.sequence)))
    .run().changes;
}
