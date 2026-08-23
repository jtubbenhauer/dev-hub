"use client";

import { formatRetryLabel } from "@/lib/chat/streaming-label";
import {
  formatDescendantActivity,
  getDescendantActivity,
  type DescendantActivityCounts,
} from "@/lib/chat/descendant-activity";
import type { MessageWithParts, SessionStatus } from "@/lib/opencode/types";
import { useChatStore } from "@/stores/chat-store";
import { memo, useEffect, useMemo, useState } from "react";

export const StreamingIndicator = memo(function StreamingIndicator({
  messages,
  sessionStatus,
  descendantActivity = EMPTY_DESCENDANT_ACTIVITY,
}: {
  messages: MessageWithParts[];
  sessionStatus: SessionStatus | null;
  descendantActivity?: DescendantActivityCounts;
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
      return formatRetryLabel(sessionStatus, now);
    }

    const descendantLabel = formatDescendantActivity(descendantActivity);
    if (descendantLabel) return descendantLabel;

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
  }, [descendantActivity, messages, sessionStatus, now]);

  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="flex gap-1">
        <span className="bg-muted-foreground/50 size-1.5 animate-bounce rounded-full [animation-delay:-0.3s]" />
        <span className="bg-muted-foreground/50 size-1.5 animate-bounce rounded-full [animation-delay:-0.15s]" />
        <span className="bg-muted-foreground/50 size-1.5 animate-bounce rounded-full" />
      </div>
      <span
        className="text-muted-foreground min-w-0 truncate text-xs"
        title={label}
      >
        {label}
      </span>
    </div>
  );
});

const VirtuosoFooter = memo(function VirtuosoFooter() {
  const [now, setNow] = useState(Date.now);
  const messages = useChatStore((s) => s.getActiveSessionMessages());
  const sessionStatus = useChatStore((s) => s.getActiveSessionStatus());
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const activeWorkspaceId = useChatStore((s) => s.activeWorkspaceId);
  const workspace = useChatStore((s) =>
    activeWorkspaceId ? s.workspaceStates[activeWorkspaceId] : undefined,
  );
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);
  const descendantActivity = useMemo(() => {
    if (!activeSessionId || !workspace) return EMPTY_DESCENDANT_ACTIVITY;
    return getDescendantActivity({
      parentSessionId: activeSessionId,
      sessions: workspace.sessions,
      statuses: workspace.sessionStatuses,
      permissions: workspace.permissions,
      questions: workspace.questions,
      now,
      recentWindowMs: 30_000,
    });
  }, [activeSessionId, now, workspace]);
  return (
    <StreamingIndicator
      messages={messages}
      sessionStatus={sessionStatus}
      descendantActivity={descendantActivity}
    />
  );
});

const VirtuosoSpacer = () => <div className="h-4" />;

export const EMPTY_COMPONENTS = { Footer: VirtuosoSpacer } as const;
export const STREAMING_COMPONENTS = { Footer: VirtuosoFooter } as const;

const EMPTY_DESCENDANT_ACTIVITY = {
  activeCount: 0,
  waitingCount: 0,
  recentCount: 0,
} as const satisfies DescendantActivityCounts;
