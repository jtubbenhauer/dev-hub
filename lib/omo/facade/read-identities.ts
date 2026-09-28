import { eq } from "drizzle-orm";
import { omoSessionIndex } from "@/drizzle/schema";
import { db } from "@/lib/db";
import { buildOmoSession } from "@/lib/omo/adapter/shapes";
import {
  jsonResponse,
  type OmoReadWorkspace,
} from "@/lib/omo/facade/read-types";

export async function readOmoSessionIdentities(
  workspace: OmoReadWorkspace,
): Promise<Response> {
  const rows = await db
    .select()
    .from(omoSessionIndex)
    .where(eq(omoSessionIndex.workspaceId, workspace.id));
  const rowsById = new Map(rows.map((row) => [row.durableId, row]));
  const roots: string[] = [];
  const children: string[] = [];
  const replaced: Array<{
    readonly old: string;
    readonly new: string;
    readonly info: ReturnType<typeof buildOmoSession>;
  }> = [];

  for (const row of rows) {
    if (row.replacedByDurableId !== null) {
      const successor = rowsById.get(row.replacedByDurableId);
      if (successor === undefined) continue;
      replaced.push({
        old: `omo_${row.durableId}`,
        new: `omo_${successor.durableId}`,
        info: buildOmoSession({
          rawId: successor.durableId,
          workspaceId: workspace.id,
          directory: workspace.path,
          title: successor.title,
          created: successor.createdMs,
          updated: successor.updatedMs,
          ...(successor.parentDurableId === null
            ? {}
            : { parentRawId: successor.parentDurableId }),
        }),
      });
      continue;
    }
    if (row.parentDurableId !== null || row.kind === "worker") {
      children.push(`omo_${row.durableId}`);
    } else {
      roots.push(`omo_${row.durableId}`);
    }
  }

  roots.sort();
  children.sort();
  replaced.sort((left, right) => left.old.localeCompare(right.old));
  return jsonResponse({ roots, children, replaced });
}
