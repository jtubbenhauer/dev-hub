import { attachOmoWriteSession } from "@/lib/omo/facade/write-access";
import { parsePromptBody } from "@/lib/omo/facade/write-body";
import type { OmoWriteContext } from "@/lib/omo/facade/write-types";
import { jsonResponse, noContentResponse } from "@/lib/omo/facade/write-types";
import { isJsonObject } from "@/lib/omo/session-registry-records";

function stateRecord(response: Readonly<Record<string, unknown>>) {
  const data = response["data"];
  return isJsonObject(data) ? data : {};
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
  await context.runtime.registry.request(binding, {
    type: "prompt",
    message: `${skillPrefix}${parsed.value.message}`,
    ...(parsed.value.images.length === 0
      ? {}
      : { images: parsed.value.images }),
    ...(state["isStreaming"] === true ? { streamingBehavior: "steer" } : {}),
  });
  return noContentResponse();
}
