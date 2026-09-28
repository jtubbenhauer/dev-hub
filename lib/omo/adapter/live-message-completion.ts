import type { AssistantMessage } from "@opencode-ai/sdk";
import {
  messageError,
  messageString,
  messageTimestamp,
  messageUsage,
} from "@/lib/omo/adapter/entry-message-fields";
import {
  parseAgentMessage,
  recordTimestamp,
} from "@/lib/omo/adapter/live-message-snapshot";
import type { ActiveAssistantMessage } from "@/lib/omo/adapter/live-message-updates";
import { buildOmoAssistantMessage } from "@/lib/omo/adapter/shapes";
import type { JsonlRecord } from "@/lib/omo/jsonl";

export interface LiveMessageCompletionContext {
  readonly sessionID: string;
  readonly workspacePath: string;
  readonly parentMessageID: string;
  readonly lastKnownModel: string;
  readonly lastKnownProvider: string;
}

export function completeAssistantMessage(
  record: JsonlRecord,
  active: ActiveAssistantMessage,
  context: LiveMessageCompletionContext,
): AssistantMessage | undefined {
  const source = parseAgentMessage(record.message);
  if (!source || source.role !== "assistant") return undefined;
  const modelID = messageString(source, "model") ?? context.lastKnownModel;
  const providerID =
    messageString(source, "provider") ?? context.lastKnownProvider;
  const completed = messageTimestamp(
    source,
    recordTimestamp(record.timestamp, active.created),
  );
  return buildOmoAssistantMessage({
    id: active.provisionalId,
    sessionID: context.sessionID,
    parentMessageID: context.parentMessageID,
    created: active.created,
    completed:
      messageString(source, "stopReason") === "pending" ? undefined : completed,
    modelID,
    providerID,
    cwd: context.workspacePath,
    usage: messageUsage(source),
    error: messageError(source),
  });
}
