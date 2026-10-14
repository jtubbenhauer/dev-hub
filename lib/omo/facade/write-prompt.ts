import { attachOmoWriteSession } from "@/lib/omo/facade/write-access";
import { parsePromptBody } from "@/lib/omo/facade/write-body";
import { lateOmoFailureMessage } from "@/lib/omo/facade/write-errors";
import type { OmoWriteContext } from "@/lib/omo/facade/write-types";
import { jsonResponse, noContentResponse } from "@/lib/omo/facade/write-types";
import type { JsonlRecord } from "@/lib/omo/jsonl";
import type { OmoSessionBinding } from "@/lib/omo/session-registry";
import { isJsonObject } from "@/lib/omo/session-registry-records";

const ACCEPTANCE_WINDOW_MS = 10_000;

function stateRecord(response: Readonly<Record<string, unknown>>) {
  const data = response["data"];
  return isJsonObject(data) ? data : {};
}

function reportLateFailure(
  context: OmoWriteContext,
  binding: OmoSessionBinding,
  error: unknown,
): void {
  context.runtime.registry.emitEvent(context.workspace.id, {
    type: "session.error",
    properties: {
      sessionID: `omo_${binding.durableId}`,
      error: {
        name: "UnknownError",
        data: { message: lateOmoFailureMessage(error) },
      },
    },
  });
}

// omo may hold a prompt or compact answer for many minutes behind compaction.
// Answering 202 instead keeps the browser from treating the wait as a failure
// and resending, which would run the prompt twice.
export async function sendWithAcceptanceWindow(
  context: OmoWriteContext,
  binding: OmoSessionBinding,
  command: JsonlRecord,
): Promise<Response> {
  const answer = context.runtime.registry.request(binding, command);
  let windowTimer: NodeJS.Timeout | undefined;
  const windowElapsed = new Promise<"pending">((resolve) => {
    windowTimer = setTimeout(() => resolve("pending"), ACCEPTANCE_WINDOW_MS);
  });
  try {
    const outcome = await Promise.race([
      answer.then(() => "answered" as const),
      windowElapsed,
    ]);
    if (outcome === "answered") return noContentResponse();
  } finally {
    clearTimeout(windowTimer);
  }
  void answer.catch((error: unknown) =>
    reportLateFailure(context, binding, error),
  );
  return new Response(null, { status: 202 });
}

export async function promptOmoSession(
  context: OmoWriteContext,
  rawId: string,
  body: unknown,
): Promise<Response> {
  const parsed = parsePromptBody(body);
  if (!parsed.ok) {
    return jsonResponse(
      { error: parsed.error },
      { status: parsed.error === "unsupported_attachment" ? 422 : 400 },
    );
  }
  const binding = await attachOmoWriteSession(context, rawId);
  const state = stateRecord(
    await context.runtime.registry.request(binding, { type: "get_state" }),
  );
  const currentModel = state["model"];
  const currentProvider = isJsonObject(currentModel)
    ? currentModel["provider"]
    : undefined;
  const currentModelId = isJsonObject(currentModel)
    ? currentModel["id"]
    : undefined;
  if (
    parsed.value.model !== undefined &&
    (parsed.value.model.providerID !== currentProvider ||
      parsed.value.model.modelID !== currentModelId)
  ) {
    await context.runtime.registry.request(binding, {
      type: "set_model",
      provider: parsed.value.model.providerID,
      modelId: parsed.value.model.modelID,
    });
  }
  if (parsed.value.variant !== undefined) {
    await context.runtime.registry.request(binding, {
      type: "set_thinking_level",
      level: parsed.value.variant,
      scope: "turn",
    });
  }
  const skillPrefix = parsed.value.agent?.startsWith("skill:")
    ? `$${parsed.value.agent.slice("skill:".length)} `
    : "";
  return sendWithAcceptanceWindow(context, binding, {
    type: "prompt",
    message: `${skillPrefix}${parsed.value.message}`,
    ...(parsed.value.images.length === 0
      ? {}
      : { images: parsed.value.images }),
    ...(state["isStreaming"] === true ? { streamingBehavior: "steer" } : {}),
  });
}
