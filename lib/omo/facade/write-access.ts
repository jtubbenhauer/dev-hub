import type { OmoWriteContext } from "@/lib/omo/facade/write-types";
import {
  getOmoIndexRow,
  type OmoSessionIndexRow,
} from "@/lib/omo/session-index";
import type { OmoSessionBinding } from "@/lib/omo/session-registry";
import { OmoSessionReplacedError } from "@/lib/omo/session-registry-errors";
import { OmoNotFoundError } from "@/lib/omo/session-source";

export async function getOmoWriteIndexRow(
  context: OmoWriteContext,
  rawId: string,
): Promise<OmoSessionIndexRow | null> {
  const row = await getOmoIndexRow(context.workspace.id, rawId);
  if (
    row?.replacedByDurableId !== null &&
    row?.replacedByDurableId !== undefined
  ) {
    throw new OmoSessionReplacedError(row.replacedByDurableId);
  }
  return row;
}

export async function attachOmoWriteSession(
  context: OmoWriteContext,
  rawId: string,
): Promise<OmoSessionBinding> {
  const row = await getOmoWriteIndexRow(context, rawId);
  if (row === null && !(await context.source.authorizeSession(rawId))) {
    throw new OmoNotFoundError(rawId);
  }
  return context.runtime.registry.attach({
    workspace: context.workspace,
    durableId: rawId,
  });
}
