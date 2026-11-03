"use client";

import {
  useChatCommands,
  type ChatCommandLabels,
  type ChatCommandRefs,
  type ChatCommandSetters,
} from "@/components/chat/use-chat-commands";

interface ChatCommandsRegistrarProps {
  readonly refs: ChatCommandRefs;
  readonly labels: ChatCommandLabels;
  readonly setters: ChatCommandSetters;
}

// Leader and palette registries are keyed by action id, so only the focused
// chat tab mounts this; a second chat would overwrite or delete its actions.
export function ChatCommandsRegistrar({
  refs,
  labels,
  setters,
}: ChatCommandsRegistrarProps) {
  useChatCommands(refs, labels, setters);
  return null;
}
