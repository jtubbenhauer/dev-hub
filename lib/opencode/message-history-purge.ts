import { and, asc, eq } from "drizzle-orm";
import { cachedMessages, recoveredMessages } from "@/drizzle/schema";
import { db } from "@/lib/db";
import { isMessageWithParts } from "@/lib/opencode/message-validation";
import { mergeRecoveredMessages } from "@/lib/opencode/merge-messages";

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

interface MessageHistoryPurge {
  readonly userId: string;
  readonly workspaceId: string;
  readonly sessionId: string;
  readonly fromMessageId?: string;
  readonly exactMessageId?: string;
}

export function purgeMessageHistory({
  userId,
  workspaceId,
  sessionId,
  fromMessageId,
  exactMessageId,
}: MessageHistoryPurge): number {
  return db.transaction((transaction) => {
    const recoveredScope = and(
      eq(recoveredMessages.userId, userId),
      eq(recoveredMessages.workspaceId, workspaceId),
      eq(recoveredMessages.sessionId, sessionId),
    );
    const cachedScope = and(
      eq(cachedMessages.userId, userId),
      eq(cachedMessages.workspaceId, workspaceId),
      eq(cachedMessages.sessionId, sessionId),
    );
    const [cached] = transaction
      .select()
      .from(cachedMessages)
      .where(cachedScope)
      .all();
    const parsedMessages: unknown = cached
      ? parseJson(cached.messagesJson)
      : [];
    const messages =
      Array.isArray(parsedMessages) && parsedMessages.every(isMessageWithParts)
        ? parsedMessages
        : [];
    const authoritativeIds: unknown = cached
      ? parseJson(cached.authoritativeMessageIdsJson)
      : [];
    const validAuthoritativeIds =
      Array.isArray(authoritativeIds) &&
      authoritativeIds.every((id) => typeof id === "string")
        ? authoritativeIds
        : [];

    if (exactMessageId !== undefined) {
      const purged = transaction
        .delete(recoveredMessages)
        .where(
          and(recoveredScope, eq(recoveredMessages.messageId, exactMessageId)),
        )
        .run().changes;
      transaction
        .update(cachedMessages)
        .set({
          messagesJson: JSON.stringify(
            messages.filter((message) => message.info.id !== exactMessageId),
          ),
          authoritativeMessageIdsJson: JSON.stringify(
            validAuthoritativeIds.filter((id) => id !== exactMessageId),
          ),
          cachedAt: Date.now(),
        })
        .where(cachedScope)
        .run();
      return purged;
    }

    if (fromMessageId !== undefined) {
      const anchorIndex = messages.findIndex(
        (message) => message.info.id === fromMessageId,
      );
      const recoveredRows = transaction
        .select({
          messageJson: recoveredMessages.messageJson,
          sequence: recoveredMessages.sequence,
        })
        .from(recoveredMessages)
        .where(recoveredScope)
        .orderBy(
          asc(recoveredMessages.sequence),
          asc(recoveredMessages.messageId),
        )
        .all();
      const recoveredEntries = recoveredRows.flatMap((row) => {
        const message = parseJson(row.messageJson);
        return isMessageWithParts(message)
          ? [{ sequence: row.sequence, message }]
          : [];
      });
      const unifiedMessages = mergeRecoveredMessages(
        messages,
        recoveredEntries,
      );
      const unifiedAnchorIndex = unifiedMessages.findIndex(
        (message) => message.info.id === fromMessageId,
      );
      const purgeIds =
        unifiedAnchorIndex >= 0
          ? unifiedMessages
              .slice(unifiedAnchorIndex)
              .map((message) => message.info.id)
          : [];
      let purged = 0;
      for (const messageId of purgeIds) {
        purged += transaction
          .delete(recoveredMessages)
          .where(
            and(recoveredScope, eq(recoveredMessages.messageId, messageId)),
          )
          .run().changes;
      }
      if (anchorIndex >= 0) {
        const retainedMessages = messages.slice(0, anchorIndex);
        const retainedIds = new Set(
          retainedMessages.map((message) => message.info.id),
        );
        transaction
          .update(cachedMessages)
          .set({
            messagesJson: JSON.stringify(retainedMessages),
            authoritativeMessageIdsJson: JSON.stringify(
              validAuthoritativeIds.filter((id) => retainedIds.has(id)),
            ),
            cachedAt: Date.now(),
          })
          .where(cachedScope)
          .run();
      }
      return purged;
    }

    const purged = transaction
      .delete(recoveredMessages)
      .where(recoveredScope)
      .run().changes;
    transaction.delete(cachedMessages).where(cachedScope).run();
    return purged;
  });
}
