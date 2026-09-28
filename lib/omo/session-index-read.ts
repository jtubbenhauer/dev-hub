import { and, eq, isNotNull, isNull, or, sql } from "drizzle-orm";
import { omoSessionIndex } from "@/drizzle/schema";
import { db } from "@/lib/db";
import { sessionIndexScope } from "@/lib/omo/session-index-database";
import type { OmoSessionIndexRow } from "@/lib/omo/session-index-types";

export async function getOmoIndexRow(
  workspaceId: string,
  durableId: string,
): Promise<OmoSessionIndexRow | null> {
  return (
    (
      await db
        .select()
        .from(omoSessionIndex)
        .where(sessionIndexScope(workspaceId, durableId))
        .limit(1)
    )[0] ?? null
  );
}

export async function getOmoChildren(
  workspaceId: string,
  parentDurableId: string,
): Promise<OmoSessionIndexRow[]> {
  return db
    .select()
    .from(omoSessionIndex)
    .where(
      and(
        eq(omoSessionIndex.workspaceId, workspaceId),
        eq(omoSessionIndex.parentDurableId, parentDurableId),
        isNull(omoSessionIndex.replacedByDurableId),
      ),
    );
}

export async function findOmoWorkerByTaskId(
  workspaceId: string,
  taskId: string,
): Promise<OmoSessionIndexRow | null> {
  return (
    (
      await db
        .select()
        .from(omoSessionIndex)
        .where(
          and(
            eq(omoSessionIndex.workspaceId, workspaceId),
            eq(omoSessionIndex.kind, "worker"),
            sql`json_extract(${omoSessionIndex.context}, '$.task_id') = ${taskId}`,
          ),
        )
        .limit(1)
    )[0] ?? null
  );
}

export async function listOmoWorkers(
  workspaceId: string,
): Promise<OmoSessionIndexRow[]> {
  return db
    .select()
    .from(omoSessionIndex)
    .where(
      and(
        eq(omoSessionIndex.workspaceId, workspaceId),
        eq(omoSessionIndex.kind, "worker"),
        isNotNull(omoSessionIndex.parentDurableId),
        isNull(omoSessionIndex.replacedByDurableId),
      ),
    );
}

export async function listOmoHiddenIds(workspaceId: string): Promise<string[]> {
  const rows = await db
    .select({ durableId: omoSessionIndex.durableId })
    .from(omoSessionIndex)
    .where(
      and(
        eq(omoSessionIndex.workspaceId, workspaceId),
        or(
          eq(omoSessionIndex.kind, "worker"),
          isNotNull(omoSessionIndex.parentDurableId),
          isNotNull(omoSessionIndex.replacedByDurableId),
        ),
      ),
    );
  return rows.map((row) => row.durableId);
}

export async function setOmoSessionTitle(
  workspaceId: string,
  durableId: string,
  title: string,
): Promise<void> {
  await db
    .update(omoSessionIndex)
    .set({ title, updatedAt: Date.now() })
    .where(sessionIndexScope(workspaceId, durableId));
}

export async function setOmoLeaf(
  workspaceId: string,
  durableId: string,
  leafEntryId: string | null,
): Promise<void> {
  await db
    .update(omoSessionIndex)
    .set({ leafKnown: 1, leafEntryId, updatedAt: Date.now() })
    .where(sessionIndexScope(workspaceId, durableId));
}

export async function setOmoLeafAndActivity(
  workspaceId: string,
  durableId: string,
  leafEntryId: string | null,
  activityMs: number,
): Promise<void> {
  await db
    .update(omoSessionIndex)
    .set({
      leafKnown: 1,
      leafEntryId,
      updatedMs: sql`max(${omoSessionIndex.updatedMs}, ${activityMs})`,
      updatedAt: Date.now(),
    })
    .where(sessionIndexScope(workspaceId, durableId));
}

export async function deleteOmoIndexRowWithDescendants(
  workspaceId: string,
  durableId: string,
): Promise<void> {
  db.run(sql`
    WITH RECURSIVE descendants(durable_id) AS (
      SELECT ${durableId}
      UNION
      SELECT child.durable_id
      FROM omo_session_index child
      JOIN descendants parent
        ON child.parent_durable_id = parent.durable_id
      WHERE child.workspace_id = ${workspaceId}
    )
    DELETE FROM omo_session_index
    WHERE workspace_id = ${workspaceId}
      AND durable_id IN (SELECT durable_id FROM descendants)
  `);
}
