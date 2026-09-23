import type { MessageWithParts } from "@/lib/opencode/types";

const NO_QUEUED_MESSAGE_IDS: ReadonlySet<string> = new Set();

// Mirrors OpenCode: a user message is queued when it was sent after the
// assistant message that is still being generated, so the agent has not
// started processing it yet.
export function getQueuedUserMessageIds(
  messages: readonly MessageWithParts[],
): ReadonlySet<string> {
  let pendingAssistantIndex = -1;
  for (let index = messages.length - 1; index >= 0; index--) {
    const { info } = messages[index];
    if (info.role !== "assistant") continue;
    if (info.time.completed == null) pendingAssistantIndex = index;
    break;
  }
  if (pendingAssistantIndex === -1) return NO_QUEUED_MESSAGE_IDS;

  const queuedIds = new Set<string>();
  for (
    let index = pendingAssistantIndex + 1;
    index < messages.length;
    index++
  ) {
    const { info } = messages[index];
    if (info.role === "user") queuedIds.add(info.id);
  }
  return queuedIds.size > 0 ? queuedIds : NO_QUEUED_MESSAGE_IDS;
}
