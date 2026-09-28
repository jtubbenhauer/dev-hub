import { OmoCommandError } from "@/lib/omo/errors";
import { attachOmoWriteSession } from "@/lib/omo/facade/write-access";
import { requiredString } from "@/lib/omo/facade/write-body";
import type { OmoWriteContext } from "@/lib/omo/facade/write-types";
import {
  invalidRequestResponse,
  jsonResponse,
  noContentResponse,
} from "@/lib/omo/facade/write-types";
import { setOmoLeaf } from "@/lib/omo/session-index";
import {
  activeHydrationBranch,
  isJsonObject,
  parseEntriesSnapshot,
  responseLeafId,
} from "@/lib/omo/session-registry-records";

function messageRole(record: Readonly<Record<string, unknown>>): string | null {
  const message = record["message"];
  return isJsonObject(message) && typeof message["role"] === "string"
    ? message["role"]
    : null;
}

function isStaleLeafError(error: unknown): boolean {
  if (
    !(error instanceof OmoCommandError) &&
    !(error instanceof Error && error.name === "OmoCommandError")
  ) {
    return false;
  }
  return isJsonObject(error) && error["errorCode"] === "stale_leaf";
}

export async function revertOmoSession(
  context: OmoWriteContext,
  rawId: string,
  body: unknown,
): Promise<Response> {
  const publicEntryId = requiredString(body, "messageID");
  const entryId =
    publicEntryId?.startsWith("omo_") === true
      ? publicEntryId.slice("omo_".length)
      : null;
  if (entryId === null || entryId.length === 0) return invalidRequestResponse();
  const binding = await attachOmoWriteSession(context, rawId);
  const snapshot = parseEntriesSnapshot(
    await context.runtime.registry.request(binding, { type: "get_entries" }),
  );
  const target = activeHydrationBranch(snapshot.entries, snapshot.leafId).find(
    (entry) => entry.id === entryId,
  );
  if (target === undefined) {
    return jsonResponse({ error: "message_not_found" }, { status: 404 });
  }
  const role = messageRole(target.record);
  const navigation =
    role === "user"
      ? { entryId: target.id, intent: "select" as const }
      : role === "assistant" && target.parentId !== null
        ? { entryId: target.parentId, intent: "resume" as const }
        : null;
  if (navigation === null) {
    return jsonResponse({ error: "invalid_revert_target" }, { status: 422 });
  }
  try {
    const response = await context.runtime.registry.request(binding, {
      type: "navigate_tree",
      ...navigation,
      expectedLeafId: snapshot.leafId,
    });
    const leafId = responseLeafId(response);
    await context.runtime.registry.enqueueLeaf(
      context.workspace.id,
      rawId,
      () => setOmoLeaf(context.workspace.id, rawId, leafId),
    );
    return noContentResponse();
  } catch (error) {
    if (isStaleLeafError(error)) {
      return jsonResponse({ error: "leaf_changed" }, { status: 409 });
    }
    throw error;
  }
}
