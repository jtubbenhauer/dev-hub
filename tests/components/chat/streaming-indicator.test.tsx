import {
  STREAMING_COMPONENTS,
  StreamingIndicator,
} from "@/components/chat/streaming-indicator";
import { useChatStore } from "@/stores/chat-store";
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("StreamingIndicator", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the retry reason reported by OpenCode", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1_000_000));

    render(
      <StreamingIndicator
        messages={[]}
        sessionStatus={{
          type: "retry",
          attempt: 2,
          message: "Provider is overloaded",
          next: 1_003_000,
        }}
      />,
    );

    expect(
      screen.getByText("Retrying... attempt 2 · 3s · Provider is overloaded"),
    ).toBeInTheDocument();
  });

  it("falls back to Thinking when there is no status or message", () => {
    render(<StreamingIndicator messages={[]} sessionStatus={null} />);
    expect(screen.getByText("Thinking...")).toBeInTheDocument();
  });

  it("shows continuing descendant work after the parent becomes idle", () => {
    render(
      <StreamingIndicator
        messages={[]}
        sessionStatus={{ type: "idle" }}
        descendantActivity={{
          activeCount: 2,
          waitingCount: 0,
          recentCount: 0,
        }}
      />,
    );

    expect(screen.getByText("2 subagents working")).toBeInTheDocument();
  });

  it("expires recently active descendants while the footer stays mounted", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-07-29T08:00:00Z");
    vi.setSystemTime(now);
    useChatStore.setState({
      activeWorkspaceId: "ws-a",
      activeSessionId: "parent",
      workspaceStates: {
        "ws-a": {
          sessions: {
            parent: {
              id: "parent",
              projectID: "project",
              directory: "/workspace",
              title: "Parent",
              version: "1",
              time: { created: now.getTime(), updated: now.getTime() },
            },
            child: {
              id: "child",
              projectID: "project",
              directory: "/workspace",
              parentID: "parent",
              title: "Child",
              version: "1",
              time: { created: now.getTime(), updated: now.getTime() },
            },
          },
          sessionsLoaded: true,
          messages: { parent: [] },
          optimisticMessageIds: {},
          sessionStatuses: {
            parent: { type: "idle" },
            child: { type: "idle" },
          },
          permissions: [],
          questions: [],
          todos: {},
          sessionAgents: {},
          sessionModels: {},
          sessionVariants: {},
          lastViewedAt: {},
          pinnedSessionIds: new Set(),
          sessionNotes: {},
        },
      },
    });

    render(<STREAMING_COMPONENTS.Footer />);
    expect(screen.getByText("1 subagent recently active")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(31_000);
    });

    expect(
      screen.queryByText("1 subagent recently active"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Thinking...")).toBeInTheDocument();
  });
});
