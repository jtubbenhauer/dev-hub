import { and, eq } from "drizzle-orm";
import {
  cachedMessages,
  cachedSessions,
  omoSessionIndex,
  pinnedSessions,
  recoveredMessages,
  sessionNotes,
} from "@/drizzle/schema";
import { db } from "@/lib/db";
import {
  OmoSessionIdentityConflictError,
  translateOmoSessionIndexError,
} from "@/lib/omo/session-index-errors";

function indexScope(workspaceId: string, durableId: string) {
  return and(
    eq(omoSessionIndex.workspaceId, workspaceId),
    eq(omoSessionIndex.durableId, durableId),
  );
}

export async function recordOmoSessionReplacement(
  workspaceId: string,
  oldId: string,
  newId: string,
  newPath: string,
): Promise<void> {
  try {
    db.transaction((transaction) => {
      const oldRow = transaction
        .select()
        .from(omoSessionIndex)
        .where(indexScope(workspaceId, oldId))
        .limit(1)
        .get();
      const successor = transaction
        .select()
        .from(omoSessionIndex)
        .where(indexScope(workspaceId, newId))
        .limit(1)
        .get();
      const pathOwner = transaction
        .select({ durableId: omoSessionIndex.durableId })
        .from(omoSessionIndex)
        .where(
          and(
            eq(omoSessionIndex.workspaceId, workspaceId),
            eq(omoSessionIndex.sessionPath, newPath),
          ),
        )
        .limit(1)
        .get();
      if (
        pathOwner &&
        pathOwner.durableId !== oldId &&
        pathOwner.durableId !== newId
      ) {
        throw new OmoSessionIdentityConflictError(workspaceId, newId, newPath);
      }

      const updatedAt = Date.now();
      if (oldRow?.sessionPath === newPath) {
        transaction
          .update(omoSessionIndex)
          .set({ sessionPath: null, updatedAt })
          .where(indexScope(workspaceId, oldId))
          .run();
      }

      const keepsSuccessorContext = successor?.contextAuthoritative === 1;
      const replacement = {
        sessionPath: newPath,
        parentDurableId:
          successor?.parentDurableId ?? oldRow?.parentDurableId ?? null,
        kind: successor?.kind ?? oldRow?.kind ?? ("interactive" as const),
        agent: successor?.agent ?? oldRow?.agent ?? null,
        category: successor?.category ?? oldRow?.category ?? null,
        context: keepsSuccessorContext
          ? successor.context
          : (oldRow?.context ?? successor?.context ?? null),
        contextAuthoritative: keepsSuccessorContext
          ? 1
          : (oldRow?.contextAuthoritative ??
            successor?.contextAuthoritative ??
            0),
        title: successor?.title ?? oldRow?.title ?? "Untitled",
        createdMs: successor?.createdMs ?? oldRow?.createdMs ?? updatedAt,
        updatedMs: successor?.updatedMs ?? oldRow?.updatedMs ?? updatedAt,
        leafKnown: successor?.leafKnown ?? oldRow?.leafKnown ?? 0,
        leafEntryId: successor?.leafEntryId ?? oldRow?.leafEntryId ?? null,
        updatedAt,
      };
      transaction
        .insert(omoSessionIndex)
        .values({ workspaceId, durableId: newId, ...replacement })
        .onConflictDoUpdate({
          target: [omoSessionIndex.workspaceId, omoSessionIndex.durableId],
          set: replacement,
        })
        .run();
      if (oldRow) {
        transaction
          .update(omoSessionIndex)
          .set({
            sessionPath:
              oldRow.sessionPath === newPath ? null : oldRow.sessionPath,
            replacedByDurableId: newId,
            updatedAt,
          })
          .where(indexScope(workspaceId, oldId))
          .run();
      }

      const oldPublicId = `omo_${oldId}`;
      const newPublicId = `omo_${newId}`;
      const oldPin = transaction
        .select()
        .from(pinnedSessions)
        .where(
          and(
            eq(pinnedSessions.workspaceId, workspaceId),
            eq(pinnedSessions.sessionId, oldPublicId),
          ),
        )
        .limit(1)
        .get();
      if (oldPin) {
        transaction
          .insert(pinnedSessions)
          .values({ ...oldPin, sessionId: newPublicId })
          .onConflictDoNothing()
          .run();
        transaction
          .delete(pinnedSessions)
          .where(
            and(
              eq(pinnedSessions.workspaceId, workspaceId),
              eq(pinnedSessions.sessionId, oldPublicId),
            ),
          )
          .run();
      }
      const oldNote = transaction
        .select()
        .from(sessionNotes)
        .where(
          and(
            eq(sessionNotes.workspaceId, workspaceId),
            eq(sessionNotes.sessionId, oldPublicId),
          ),
        )
        .limit(1)
        .get();
      if (oldNote) {
        transaction
          .insert(sessionNotes)
          .values({ ...oldNote, sessionId: newPublicId })
          .onConflictDoNothing()
          .run();
        transaction
          .delete(sessionNotes)
          .where(
            and(
              eq(sessionNotes.workspaceId, workspaceId),
              eq(sessionNotes.sessionId, oldPublicId),
            ),
          )
          .run();
      }

      transaction
        .delete(cachedSessions)
        .where(
          and(
            eq(cachedSessions.workspaceId, workspaceId),
            eq(cachedSessions.id, oldPublicId),
          ),
        )
        .run();
      transaction
        .delete(cachedMessages)
        .where(
          and(
            eq(cachedMessages.workspaceId, workspaceId),
            eq(cachedMessages.sessionId, oldPublicId),
          ),
        )
        .run();
      transaction
        .delete(recoveredMessages)
        .where(
          and(
            eq(recoveredMessages.workspaceId, workspaceId),
            eq(recoveredMessages.sessionId, oldPublicId),
          ),
        )
        .run();
    });
  } catch (error) {
    translateOmoSessionIndexError(error, workspaceId, newId, newPath);
  }
}
