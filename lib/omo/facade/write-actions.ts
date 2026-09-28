import { responseForAnswers } from "@/lib/omo/adapter/dialog-responses";
import { attachOmoWriteSession } from "@/lib/omo/facade/write-access";
import {
  optionalArguments,
  questionAnswers,
  requiredString,
} from "@/lib/omo/facade/write-body";
import type { OmoWriteContext } from "@/lib/omo/facade/write-types";
import {
  invalidRequestResponse,
  jsonResponse,
  noContentResponse,
} from "@/lib/omo/facade/write-types";
import { getOmoIndexRow, readStoredContext } from "@/lib/omo/session-index";
import { OmoCorruptIndexRowError } from "@/lib/omo/session-registry-errors";
import { isJsonObject } from "@/lib/omo/session-registry-records";

export async function abortOmoSession(
  context: OmoWriteContext,
  rawId: string,
): Promise<Response> {
  const row = await getOmoIndexRow(context.workspace.id, rawId);
  if (row?.kind === "worker") {
    const storedContext = readStoredContext(row);
    const taskId = storedContext?.["task_id"];
    if (
      row.contextAuthoritative !== 1 ||
      row.parentDurableId === null ||
      typeof taskId !== "string"
    ) {
      throw new OmoCorruptIndexRowError(context.workspace.id, rawId);
    }
    const parent = await attachOmoWriteSession(context, row.parentDurableId);
    await context.runtime.registry.request(parent, {
      type: "extension_request",
      name: "omo.task.cancel",
      data: { task_id: taskId },
    });
    return noContentResponse();
  }
  const binding = await attachOmoWriteSession(context, rawId);
  await context.runtime.registry.request(binding, { type: "abort" });
  return noContentResponse();
}

export async function commandOmoSession(
  context: OmoWriteContext,
  rawId: string,
  body: unknown,
): Promise<Response> {
  const command = requiredString(body, "command");
  const argumentsValue = optionalArguments(body);
  if (command === null || argumentsValue === undefined) {
    return invalidRequestResponse();
  }
  const binding = await attachOmoWriteSession(context, rawId);
  await context.runtime.registry.request(binding, {
    type: "prompt",
    message: `/${command}${argumentsValue === null ? "" : ` ${argumentsValue}`}`,
  });
  return noContentResponse();
}

export async function summarizeOmoSession(
  context: OmoWriteContext,
  rawId: string,
): Promise<Response> {
  const binding = await attachOmoWriteSession(context, rawId);
  await context.runtime.registry.request(binding, { type: "compact" });
  return noContentResponse();
}

export async function forkOmoSession(
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
  const response = await context.runtime.registry.request(binding, {
    type: "fork",
    entryId,
  });
  const data = response["data"];
  return jsonResponse(isJsonObject(data) ? data : {});
}

export type OmoQuestionActionInput = {
  readonly publicId: string;
  readonly action: "reply" | "reject";
  readonly body: unknown;
};

export async function answerOmoQuestion(
  context: OmoWriteContext,
  input: OmoQuestionActionInput,
): Promise<Response> {
  const entry = context.dialogs.find(input.publicId);
  if (entry === undefined || entry.workspaceId !== context.workspace.id) {
    return jsonResponse({ error: "question_not_found" }, { status: 404 });
  }
  const command =
    input.action === "reply"
      ? (() => {
          const answers = questionAnswers(input.body);
          return answers === null ? null : responseForAnswers(entry, answers);
        })()
      : {
          type: "extension_ui_response",
          id: entry.extUiId,
          sessionId: entry.routingHandle,
          cancelled: true,
        };
  if (command === null) return invalidRequestResponse();
  const binding = await attachOmoWriteSession(context, entry.durableId);
  await context.runtime.registry.request(binding, command);
  context.dialogs.resolve(input.publicId);
  return noContentResponse();
}
