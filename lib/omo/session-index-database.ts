import { and, eq } from "drizzle-orm";
import { omoSessionIndex } from "@/drizzle/schema";
import { db } from "@/lib/db";
import { OmoSessionIdentityConflictError } from "@/lib/omo/session-index-errors";

export type SessionIndexTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];

export function sessionIndexScope(workspaceId: string, durableId: string) {
  return and(
    eq(omoSessionIndex.workspaceId, workspaceId),
    eq(omoSessionIndex.durableId, durableId),
  );
}

export function assertOmoSessionPathAvailable(
  transaction: SessionIndexTransaction,
  workspaceId: string,
  durableId: string,
  sessionPath: string | null,
): void {
  if (sessionPath === null) return;
  const owner = transaction
    .select({ durableId: omoSessionIndex.durableId })
    .from(omoSessionIndex)
    .where(
      and(
        eq(omoSessionIndex.workspaceId, workspaceId),
        eq(omoSessionIndex.sessionPath, sessionPath),
      ),
    )
    .limit(1)
    .get();
  if (owner && owner.durableId !== durableId) {
    throw new OmoSessionIdentityConflictError(
      workspaceId,
      durableId,
      sessionPath,
    );
  }
}
