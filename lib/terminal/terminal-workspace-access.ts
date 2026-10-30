import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { workspaces } from "@/drizzle/schema";

export async function isWorkspaceOwnedByUser(
  userId: string,
  workspaceId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(and(eq(workspaces.id, workspaceId), eq(workspaces.userId, userId)));
  return !!row;
}

export async function listOwnedWorkspaceIds(
  userId: string,
): Promise<Set<string>> {
  const rows = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.userId, userId));
  return new Set(rows.map((row) => row.id));
}
