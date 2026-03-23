"use client";

import type { MessageWithParts, SessionStatus } from "@/lib/opencode/types";
import { useChatStore } from "@/stores/chat-store";
import { memo, useEffect, useMemo, useState } from "react";

const StreamingIndicator = memo(function StreamingIndicator({
  messages,
  sessionStatus,
}: {
  messages: MessageWithParts[];
  sessionStatus: SessionStatus | null;
}) {
  const [now, setNow] = useState(Date.now);
  const isRetrying = sessionStatus?.type === "retry";

  useEffect(() => {
    if (!isRetrying) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isRetrying]);

  const label = useMemo(() => {
    if (sessionStatus?.type === "retry") {
      const secondsUntilRetry = Math.max(
        0,
        Math.ceil((sessionStatus.next - now) / 1000),
      );
      return `Retrying... attempt ${sessionStatus.attempt}${secondsUntilRetry > 0 ? ` · ${secondsUntilRetry}s` : ""}`;
    }

    const lastAssistant = [...messages]
      .reverse()
      .find((m) => m.info.role === "assistant");
    if (!lastAssistant) return "Thinking...";

    const { parts } = lastAssistant;

    const hasCompaction = parts.some((p) => p.type === "compaction");
    if (hasCompaction) return "Compacting context...";

    const runningTool = [...parts]
      .reverse()
      .find((p) => p.type === "tool" && p.state.status === "running");
    if (runningTool?.type === "tool") {
      return `Running: ${runningTool.state.status === "running" && runningTool.state.title ? runningTool.state.title : runningTool.tool}`;
    }

    const subtask = [...parts].reverse().find((p) => p.type === "subtask");
    if (subtask?.type === "subtask") {
      return `Subagent: ${subtask.description || subtask.agent}`;
    }

    return "Thinking...";
  }, [messages, sessionStatus, now]);

  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="flex gap-1">
        <span className="bg-muted-foreground/50 size-1.5 animate-bounce rounded-full [animation-delay:-0.3s]" />
        <span className="bg-muted-foreground/50 size-1.5 animate-bounce rounded-full [animation-delay:-0.15s]" />
        <span className="bg-muted-foreground/50 size-1.5 animate-bounce rounded-full" />
      </div>
      <span className="text-muted-foreground text-xs">{label}</span>
    </div>
  );
});

const VirtuosoFooter = memo(function VirtuosoFooter() {
  const messages = useChatStore((s) => s.getActiveSessionMessages());
  const sessionStatus = useChatStore((s) => s.getActiveSessionStatus());
  return (
    <StreamingIndicator messages={messages} sessionStatus={sessionStatus} />
  );
});

const VirtuosoSpacer = () => <div className="h-4" />;

export const EMPTY_COMPONENTS = { Footer: VirtuosoSpacer } as const;
export const STREAMING_COMPONENTS = { Footer: VirtuosoFooter } as const;
