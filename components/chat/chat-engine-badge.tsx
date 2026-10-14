"use client";

import { Badge } from "@/components/ui/badge";
import { useActiveChatEngine } from "@/hooks/use-active-chat-engine";
import type { ChatEngine } from "@/lib/engine/types";

interface ChatEngineBadgeProps {
  engine: ChatEngine;
}

export function ChatEngineBadge({ engine }: ChatEngineBadgeProps) {
  if (engine !== "omo") return null;

  return (
    <Badge
      variant="outline"
      className="text-muted-foreground px-1.5 py-0 font-mono text-[10px]"
      title="Chat engine: OmO Native"
    >
      omo
    </Badge>
  );
}

interface ActiveChatEngineBadgeProps {
  workspaceId: string | null;
}

export function ActiveChatEngineBadge({
  workspaceId,
}: ActiveChatEngineBadgeProps) {
  const { engine, isLoading } = useActiveChatEngine(workspaceId);
  if (isLoading) return null;
  return <ChatEngineBadge engine={engine} />;
}
