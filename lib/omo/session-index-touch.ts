import { omoSessionIndex } from "@/drizzle/schema";
import { db } from "@/lib/db";
import {
  assertOmoSessionPathAvailable,
  sessionIndexScope,
  type SessionIndexTransaction,
} from "@/lib/omo/session-index-database";
import { translateOmoSessionIndexError } from "@/lib/omo/session-index-errors";
import type {
  OmoSessionTouchMetadata,
  OmoSessionTouchRow,
} from "@/lib/omo/session-index-types";

function touchInTransaction(
  transaction: SessionIndexTransaction,
  workspaceId: string,
  row: OmoSessionTouchRow,
): number {
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
  const updatedAt = Date.now();
  if (!existing) {
    transaction
      .insert(omoSessionIndex)
      .values({
        workspaceId,
        ...row,
        kind: "interactive",
        updatedAt,
      })
      .run();
    return 1;
  }

  const changes: Partial<typeof omoSessionIndex.$inferInsert> = {};
  if (row.sessionPath !== null && row.sessionPath !== existing.sessionPath) {
    changes.sessionPath = row.sessionPath;
  }
  if (row.title !== existing.title) changes.title = row.title;
  if (row.createdMs !== existing.createdMs) changes.createdMs = row.createdMs;
  if (row.updatedMs > existing.updatedMs) changes.updatedMs = row.updatedMs;
  if (Object.keys(changes).length === 0) return 0;
  changes.updatedAt = updatedAt;
  transaction
    .update(omoSessionIndex)
    .set(changes)
    .where(sessionIndexScope(workspaceId, row.durableId))
    .run();
  return 1;
}

export async function touchOmoSessionIndex(
  workspaceId: string,
  durableId: string,
  sessionPath: string | null,
  metadata: OmoSessionTouchMetadata,
): Promise<number> {
  try {
    return db.transaction((transaction) =>
      touchInTransaction(transaction, workspaceId, {
        ...metadata,
        durableId,
        sessionPath,
      }),
    );
  } catch (error) {
    translateOmoSessionIndexError(error, workspaceId, durableId, sessionPath);
  }
}

export async function touchOmoSessionIndexMany(
  workspaceId: string,
  rows: readonly OmoSessionTouchRow[],
): Promise<number> {
  try {
    return db.transaction((transaction) =>
      rows.reduce(
        (changed, row) =>
          changed + touchInTransaction(transaction, workspaceId, row),
        0,
      ),
    );
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
