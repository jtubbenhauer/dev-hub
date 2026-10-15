import { and, eq, ne } from "drizzle-orm";
import { omoSessionIndex } from "@/drizzle/schema";
import { db } from "@/lib/db";

export type SessionIndexTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];

export function sessionIndexScope(workspaceId: string, durableId: string) {
  return and(
    eq(omoSessionIndex.workspaceId, workspaceId),
    eq(omoSessionIndex.durableId, durableId),
  );
}

// omo can reuse a transcript file for a new session. Callers pass the file's
// current owner (from its header or the host), so other claims are stale.
export function releaseOmoSessionPathFromOtherRows(
  transaction: SessionIndexTransaction,
  workspaceId: string,
  durableId: string,
  sessionPath: string | null,
): void {
  if (sessionPath === null) return;
  transaction
    .update(omoSessionIndex)
    .set({ sessionPath: null, updatedAt: Date.now() })
    .where(
      and(
        eq(omoSessionIndex.workspaceId, workspaceId),
        eq(omoSessionIndex.sessionPath, sessionPath),
        ne(omoSessionIndex.durableId, durableId),
      ),
    )
    .run();
}
