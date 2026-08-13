import { SubAgentDialog } from "@/components/chat/sub-agent-dialog";
import { useChatStore } from "@/stores/chat-store";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
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
    | { type: "busy" }
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
        todos: {
          child: [
            {
              id: "todo-1",
              content: "child task",
              status: "in_progress",
              priority: "high",
            },
          ],
        },
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

  it("bounds the task list and gives it vertical scroll ownership", () => {
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

    const taskList = document.querySelector('[data-slot="task-progress-list"]');
    expect(taskList).toHaveClass(
      "max-h-[min(40dvh,24rem)]",
      "overflow-y-auto",
      "overscroll-contain",
    );
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

  it("aborts only the active child session", async () => {
    setChildSessionStatus({ type: "busy" });
    const user = userEvent.setup();
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

    await user.click(screen.getByRole("button", { name: "Abort" }));

    expect(fetch).toHaveBeenCalledWith(
      "/api/opencode/session/child/abort?workspaceId=ws-a",
      { method: "POST" },
    );
    expect(screen.getByText("Idle")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Abort" }),
    ).not.toBeInTheDocument();
  });

  it("disables Abort while the child cancellation is pending", async () => {
    setChildSessionStatus({ type: "busy" });
    let resolveAbort: (response: Response) => void = () => {};
    vi.mocked(fetch).mockImplementation((input) => {
      if (String(input).includes("/abort")) {
        return new Promise<Response>((resolve) => {
          resolveAbort = resolve;
        });
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({ messages: [], hasMore: false, total: 0 }),
          { status: 200 },
        ),
      );
    });
    const user = userEvent.setup();
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

    await user.click(screen.getByRole("button", { name: "Abort" }));
    expect(screen.getByRole("button", { name: "Aborting" })).toBeDisabled();

    await act(async () => {
      resolveAbort(new Response(null, { status: 204 }));
    });
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Aborting" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("shows a retryable error when abort fails", async () => {
    setChildSessionStatus({ type: "busy" });
    vi.mocked(fetch).mockImplementation((input) =>
      Promise.resolve(
        String(input).includes("/abort")
          ? new Response(null, { status: 500 })
          : new Response(
              JSON.stringify({ messages: [], hasMore: false, total: 0 }),
              { status: 200 },
            ),
      ),
    );
    const user = userEvent.setup();
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

    await user.click(screen.getByRole("button", { name: "Abort" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not abort this sub-agent. Try again.",
    );
    expect(screen.getByRole("button", { name: "Abort" })).toBeEnabled();
  });

  it("hides Abort for an idle child", () => {
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

    expect(
      screen.queryByRole("button", { name: "Abort" }),
    ).not.toBeInTheDocument();
  });

  it("restores Abort when an aborted child starts working again", async () => {
    setChildSessionStatus({ type: "busy" });
    const user = userEvent.setup();
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

    await user.click(screen.getByRole("button", { name: "Abort" }));
    await user.click(screen.getByRole("button", { name: "Nudge" }));
    act(() => setChildSessionStatus({ type: "busy" }));

    expect(await screen.findByText("Working...")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Abort" })).toBeEnabled();
  });
});
