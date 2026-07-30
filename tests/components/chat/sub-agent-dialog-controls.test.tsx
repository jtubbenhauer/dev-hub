import { SubAgentDialog } from "@/components/chat/sub-agent-dialog";
import { useChatStore } from "@/stores/chat-store";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/stores/workspace-store", () => ({
  useWorkspaceStore: () => "ws-a",
}));

vi.mock("@/hooks/use-git", () => ({
  useWorkspaceGitHub: () => null,
}));

function setChildSessionStatus(
  status:
    | { type: "idle" }
    | {
        type: "retry";
        attempt: number;
        message: string;
        next: number;
      },
): void {
  useChatStore.setState({
    activeWorkspaceId: "ws-a",
    activeSessionId: "parent",
    workspaceStates: {
      "ws-a": {
        sessions: {},
        sessionsLoaded: true,
        messages: { child: [] },
        optimisticMessageIds: {},
        sessionStatuses: { child: status },
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
}

describe("SubAgentDialog controls", () => {
  beforeEach(() => {
    vi.setSystemTime(new Date("2026-07-29T00:00:00Z"));
    setChildSessionStatus({ type: "idle" });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              messages: [],
              hasMore: false,
              total: 0,
              source: "remote",
            }),
            { status: 200 },
          ),
      ),
    );
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("shows the retry attempt, countdown, and provider reason", () => {
    setChildSessionStatus({
      type: "retry",
      attempt: 3,
      message: "Provider is overloaded",
      next: Date.now() + 5_000,
    });

    render(
      <SubAgentDialog
        childSessionId="child"
        workspaceId="ws-a"
        description="Child"
        isActive
        open
        onOpenChange={() => {}}
      />,
    );

    expect(
      screen.getByText("Retrying... attempt 3 · 5s · Provider is overloaded"),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Retrying, attempt 3. Provider is overloaded",
    );
    expect(screen.getByRole("status")).not.toHaveTextContent("5s");
  });

  it("sends continue to the child session when Nudge is pressed", async () => {
    const user = userEvent.setup();
    render(
      <SubAgentDialog
        childSessionId="child"
        workspaceId="ws-a"
        description="Child"
        isActive={false}
        open
        onOpenChange={() => {}}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Nudge" }));

    expect(fetch).toHaveBeenCalledWith(
      "/api/opencode/session/child/prompt_async?workspaceId=ws-a",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ parts: [{ type: "text", text: "continue" }] }),
      }),
    );
  });
});
