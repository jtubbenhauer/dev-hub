import type { Message, Part, UserMessage } from "@opencode-ai/sdk";
import type { ActiveAssistantMessage } from "@/lib/omo/adapter/live-message-updates";
import type { Event } from "@/lib/opencode/types";

export interface ActiveUserMessage {
  readonly role: "user";
  readonly provisionalId: string;
  readonly created: number;
  readonly parts: Map<number, Part>;
  info: UserMessage;
}

export type ActiveMessage = ActiveUserMessage | ActiveAssistantMessage;

export function messageUpdated(info: Message): Event {
  return { type: "message.updated", properties: { info } };
}
