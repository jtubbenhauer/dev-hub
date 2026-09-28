import type { MessageWithParts } from "@/lib/opencode/types";
import type { SessionEntry } from "@/lib/omo/sessions-on-disk";
import {
  appendMessageEntry,
  appendSyntheticMessage,
  type ConversionContext,
} from "@/lib/omo/adapter/entry-message-builders";
import { displayText } from "@/lib/omo/adapter/entry-message-fields";

export function entriesToMessages(
  entries: SessionEntry[],
  {
    sessionId,
    workspacePath,
    skillPrefixes,
  }: {
    readonly sessionId: string;
    readonly workspacePath: string;
    readonly skillPrefixes: string[];
  },
): MessageWithParts[] {
  const context: ConversionContext = {
    sessionId,
    workspacePath,
    skillPrefixes,
    messages: [],
    tools: new Map(),
    lastKnownProvider: "omo",
    lastKnownModel: "unknown",
    lastUserMessageID: sessionId,
  };
  for (const entry of entries) {
    switch (entry.type) {
      case "message":
        appendMessageEntry(entry, context);
        break;
      case "model_change":
        context.lastKnownProvider = entry.provider;
        context.lastKnownModel = entry.modelId;
        break;
      case "compaction":
        appendSyntheticMessage(
          {
            entry,
            text: `[compaction] ${entry.summary}`,
            source: entry.type,
            isCompaction: true,
          },
          context,
        );
        break;
      case "branch_summary":
        appendSyntheticMessage(
          { entry, text: entry.summary, source: entry.type },
          context,
        );
        break;
      case "custom":
        break;
      case "custom_message":
        if (!entry.display) break;
        appendSyntheticMessage(
          { entry, text: displayText(entry.content), source: entry.type },
          context,
        );
        break;
      case "thinking_level_change":
      case "label":
      case "session_info":
        break;
      default:
        break;
    }
  }
  return context.messages;
}

export function windowMessages(
  messages: MessageWithParts[],
  {
    limit,
    before,
  }: { readonly limit: number; readonly before?: string | null },
): MessageWithParts[] {
  const normalizedLimit = Math.max(0, Math.floor(limit));
  if (before) {
    const anchorIndex = messages.findIndex(
      (message) => message.info.id === before,
    );
    if (anchorIndex === -1) return [];
    return messages.slice(
      Math.max(0, anchorIndex - normalizedLimit),
      anchorIndex,
    );
  }
  return messages.slice(Math.max(0, messages.length - normalizedLimit));
}
