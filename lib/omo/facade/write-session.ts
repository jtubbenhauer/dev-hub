import { buildOmoSession } from "@/lib/omo/adapter/shapes";
import { getOmoWriteIndexRow } from "@/lib/omo/facade/write-access";
import { requiredString } from "@/lib/omo/facade/write-body";
import type { OmoWriteContext } from "@/lib/omo/facade/write-types";
import {
  invalidRequestResponse,
  jsonResponse,
  noContentResponse,
  sessionNotFoundResponse,
} from "@/lib/omo/facade/write-types";
import type { JsonlRecord } from "@/lib/omo/jsonl";
import {
  deleteOmoIndexRowWithDescendants,
  getOmoIndexRow,
  setOmoSessionTitle,
  type OmoSessionIndexRow,
} from "@/lib/omo/session-index";
import { isJsonObject } from "@/lib/omo/session-registry-records";

function sessionFromRow(context: OmoWriteContext, row: OmoSessionIndexRow) {
  return buildOmoSession({
    rawId: row.durableId,
    workspaceId: context.workspace.id,
    directory: context.workspace.path,
    title: row.title,
    created: row.createdMs,
    updated: row.updatedMs,
    ...(row.parentDurableId === null
      ? {}
      : { parentRawId: row.parentDurableId }),
  });
}

function sessionAttachmentCount(response: JsonlRecord, rawId: string): number {
  const data = response["data"];
  if (!isJsonObject(data) || !Array.isArray(data["sessions"])) return 0;
  for (const session of data["sessions"]) {
    if (!isJsonObject(session) || session["durableSessionId"] !== rawId) {
      continue;
    }
    return typeof session["attachments"] === "number"
      ? session["attachments"]
      : 0;
  }
  return 0;
}

export async function createOmoSession(
  context: OmoWriteContext,
): Promise<Response> {
  const binding = await context.runtime.registry.create({
    workspace: context.workspace,
  });
  const row = await getOmoIndexRow(context.workspace.id, binding.durableId);
  if (row !== null) return jsonResponse(sessionFromRow(context, row));
  const now = Date.now();
  return jsonResponse(
    buildOmoSession({
      rawId: binding.durableId,
      workspaceId: context.workspace.id,
      directory: context.workspace.path,
      title: binding.openedState.title,
      created: now,
      updated: now,
    }),
  );
}

export async function deleteOmoSession(
  context: OmoWriteContext,
  rawId: string,
): Promise<Response> {
  let row = await getOmoWriteIndexRow(context, rawId);
  if (row === null) return sessionNotFoundResponse();
  if (row.kind === "worker") {
    return jsonResponse({ error: "worker_session" }, { status: 403 });
  }
  if (row.sessionPath === null) {
    await context.runtime.registry.refreshIndexFromHost(context.workspace);
    row = await getOmoWriteIndexRow(context, rawId);
    if (row === null || row.sessionPath === null) {
      return jsonResponse({ error: "session_not_resolvable" }, { status: 409 });
    }
  }
  const listed = await context.runtime.client.request({
    type: "list_sessions",
    include_workers: true,
  });
  if (sessionAttachmentCount(listed, rawId) > 1) {
    return jsonResponse({ error: "session_in_use" }, { status: 409 });
  }
  const binding = context.runtime.registry.findBinding(
    context.workspace.id,
    rawId,
    row.sessionPath,
  );
  if (binding !== undefined) {
    await context.runtime.client.request({
      type: "close_session",
      sessionId: binding.routingHandle,
    });
    context.runtime.registry.cleanupBinding(binding);
  }
  await context.source.remove(rawId);
  await deleteOmoIndexRowWithDescendants(context.workspace.id, rawId);
  return noContentResponse();
}

export async function renameOmoSession(
  context: OmoWriteContext,
  rawId: string,
  body: unknown,
): Promise<Response> {
  const title = requiredString(body, "title");
  if (title === null) return invalidRequestResponse();
  const binding = await context.runtime.registry.attach({
    workspace: context.workspace,
    durableId: rawId,
  });
  await context.runtime.registry.request(binding, {
    type: "set_session_name",
    name: title,
  });
  await setOmoSessionTitle(context.workspace.id, rawId, title);
  const row = await getOmoWriteIndexRow(context, rawId);
  if (row === null) return sessionNotFoundResponse();
  const session = sessionFromRow(context, row);
  context.runtime.registry.emitEvent(context.workspace.id, {
    type: "session.updated",
    properties: { info: session },
  });
  return jsonResponse(session);
}
