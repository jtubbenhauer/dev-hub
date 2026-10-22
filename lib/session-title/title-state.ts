import { and, eq } from "drizzle-orm";
import { sessionTitleStates } from "@/drizzle/schema";
import { db } from "@/lib/db";

export type AutoTitleClaim = "claimed" | "already_titled" | "renamed_by_user";

function stateScope(workspaceId: string, sessionId: string) {
  return and(
    eq(sessionTitleStates.workspaceId, workspaceId),
    eq(sessionTitleStates.sessionId, sessionId),
  );
}

// Claims a turn so several open tabs title it once, and backs off for good
// once the title no longer matches the last one generated here.
export function claimAutoTitleTurn(
  workspaceId: string,
  sessionId: string,
  turn: number,
  currentTitle: string,
): AutoTitleClaim {
  return db.transaction((transaction) => {
    const existing = transaction
      .select()
      .from(sessionTitleStates)
      .where(stateScope(workspaceId, sessionId))
      .get();
    if (existing && existing.lastAutoTitleTurn >= turn) return "already_titled";
    if (
      existing?.lastGeneratedTitle != null &&
      existing.lastGeneratedTitle !== currentTitle
    ) {
      return "renamed_by_user";
    }
    const updatedAt = Date.now();
    transaction
      .insert(sessionTitleStates)
      .values({ workspaceId, sessionId, lastAutoTitleTurn: turn, updatedAt })
      .onConflictDoUpdate({
        target: [sessionTitleStates.workspaceId, sessionTitleStates.sessionId],
        set: { lastAutoTitleTurn: turn, updatedAt },
      })
      .run();
    return "claimed";
  });
}

export function recordGeneratedTitle(
  workspaceId: string,
  sessionId: string,
  title: string,
): void {
  const updatedAt = Date.now();
  db.insert(sessionTitleStates)
    .values({ workspaceId, sessionId, lastGeneratedTitle: title, updatedAt })
    .onConflictDoUpdate({
      target: [sessionTitleStates.workspaceId, sessionTitleStates.sessionId],
      set: { lastGeneratedTitle: title, updatedAt },
    })
    .run();
}
