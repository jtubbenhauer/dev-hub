import { omoSessionIndex } from "@/drizzle/schema";
import { db } from "@/lib/db";
import { parseOmoSessionContext } from "@/lib/omo/session-context";
import {
  assertOmoSessionPathAvailable,
  sessionIndexScope,
} from "@/lib/omo/session-index-database";
import { translateOmoSessionIndexError } from "@/lib/omo/session-index-errors";
import type {
  OmoAuthoritativeSessionRow,
  OmoTaskEventSessionRow,
} from "@/lib/omo/session-index-types";

export async function upsertOmoSessionIndexAuthoritative(
  workspaceId: string,
  rows: readonly OmoAuthoritativeSessionRow[],
): Promise<number> {
  try {
    return db.transaction((transaction) => {
      let changed = 0;
      for (const row of rows) {
        const context = parseOmoSessionContext(row.context);
        if (context === null) {
          console.warn("Skipping OMO index row with invalid context", {
            workspaceId,
            durableId: row.durableId,
          });
          continue;
        }
        assertOmoSessionPathAvailable(
          transaction,
          workspaceId,
          row.durableId,
          row.sessionPath,
        );
        const existing = transaction
          .select()
          .from(omoSessionIndex)
          .where(sessionIndexScope(workspaceId, row.durableId))
          .limit(1)
          .get();
        const insertValues = {
          workspaceId,
          durableId: row.durableId,
          sessionPath: row.sessionPath,
          parentDurableId: existing?.parentDurableId ?? row.parentDurableId,
          kind: row.kind,
          agent: existing?.agent ?? row.agent,
          category: existing?.category ?? row.category,
          context: JSON.stringify(context),
          contextAuthoritative: 1,
          title: row.title,
          createdMs: row.createdMs,
          updatedMs: Math.max(existing?.updatedMs ?? 0, row.updatedMs),
          updatedAt: Date.now(),
        };
        const updateValues = {
          sessionPath: insertValues.sessionPath,
          parentDurableId: insertValues.parentDurableId,
          kind: insertValues.kind,
          agent: insertValues.agent,
          category: insertValues.category,
          context: insertValues.context,
          contextAuthoritative: insertValues.contextAuthoritative,
          title: insertValues.title,
          createdMs: insertValues.createdMs,
          updatedMs: insertValues.updatedMs,
          updatedAt: insertValues.updatedAt,
        };
        transaction
          .insert(omoSessionIndex)
          .values(insertValues)
          .onConflictDoUpdate({
            target: [omoSessionIndex.workspaceId, omoSessionIndex.durableId],
            set: updateValues,
          })
          .run();
        changed += 1;
      }
      return changed;
    });
  } catch (error) {
    const row = rows.find((candidate) => candidate.sessionPath !== null);
    translateOmoSessionIndexError(
      error,
      workspaceId,
      row?.durableId ?? "unknown",
      row?.sessionPath ?? null,
    );
  }
}

export async function mergeOmoSessionIndexFromTaskEvent(
  workspaceId: string,
  rows: readonly OmoTaskEventSessionRow[],
): Promise<number> {
  return db.transaction((transaction) => {
    let changed = 0;
    for (const row of rows) {
      const existing = transaction
        .select()
        .from(omoSessionIndex)
        .where(sessionIndexScope(workspaceId, row.durableId))
        .limit(1)
        .get();
      const now = Date.now();
      const title = row.title ?? row.agent ?? row.category ?? "task";
      const createdMs = row.createdMs ?? now;
      const updatedMs = Math.max(existing?.updatedMs ?? 0, row.updatedMs ?? now);
      transaction
        .insert(omoSessionIndex)
        .values({
          workspaceId,
          durableId: row.durableId,
          sessionPath: null,
          parentDurableId: row.parentDurableId,
          kind: "worker",
          agent: row.agent,
          category: row.category,
          title,
          createdMs,
          updatedMs,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [omoSessionIndex.workspaceId, omoSessionIndex.durableId],
          set: {
            kind: "worker",
            parentDurableId: row.parentDurableId ?? existing?.parentDurableId,
            agent: row.agent ?? existing?.agent,
            category: row.category ?? existing?.category,
            title: row.title ?? existing?.title ?? title,
            updatedMs,
            updatedAt: now,
          },
        })
        .run();
      changed += 1;
    }
    return changed;
  });
}
