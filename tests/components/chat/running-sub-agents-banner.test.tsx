import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RunningSubAgentsBanner } from "@/components/chat/running-sub-agents-banner";
import { useChatStore, type WorkspaceState } from "@/stores/chat-store";

vi.mock("@/components/chat/sub-agent-dialog", () => ({
  SubAgentDialog: ({
    open,
    description,
  }: {
    open: boolean;
    description: string;
  }) => (open ? <div role="dialog">{description}</div> : null),
}));

afterEach(() => {
  cleanup();
  useChatStore.setState({ workspaceStates: {} });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("RunningSubAgentsBanner", () => {
  it("lists only running descendants with their task progress", () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => [] });
    useChatStore.setState({
      workspaceStates: {
        "ws-1": {
          sessionsLoaded: true,
          sessions: {
            parent: makeSession("parent", "Parent"),
            running: makeSession("running", "Review implementation", "parent"),
            idle: makeSession("idle", "Finished review", "parent"),
          },
          messages: {},
          optimisticMessageIds: {},
          sessionStatuses: {
            running: { type: "busy" },
            idle: { type: "idle" },
          },
          permissions: [],
          questions: [],
          todos: {
            running: [
              {
                id: "1",
                content: "Done",
                status: "completed",
                priority: "high",
              },
              {
                id: "2",
                content: "Next",
                status: "pending",
                priority: "medium",
              },
            ],
          },
          todoUpdatedAt: { running: Date.now() },
          sessionAgents: {},
          sessionModels: {},
          sessionVariants: {},
          lastViewedAt: {},
          pinnedSessionIds: new Set(),
          sessionNotes: {},
        },
      },
    });

    render(
      <RunningSubAgentsBanner parentSessionId="parent" workspaceId="ws-1" />,
    );

    expect(screen.getByText("1 running")).toBeInTheDocument();
    expect(screen.getByText("Review implementation")).toBeInTheDocument();
    expect(screen.getByText("1/2")).toBeInTheDocument();
    expect(screen.queryByText("Finished review")).not.toBeInTheDocument();
    const banner = screen.getByRole("region", { name: "Running sub-agents" });
    expect(banner).toHaveClass("px-4");
    expect(banner.firstElementChild).toHaveClass("w-full");
  });

  it("opens the selected sub-agent detail", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => [] });
    useChatStore.setState({
      workspaceStates: {
        "ws-1": {
          sessionsLoaded: true,
          sessions: {
            parent: makeSession("parent", "Parent"),
            running: makeSession("running", "Review implementation", "parent"),
          },
          messages: {},
          optimisticMessageIds: {},
          sessionStatuses: { running: { type: "busy" } },
          permissions: [],
          questions: [],
          todos: {},
          todoUpdatedAt: {},
          sessionAgents: {},
          sessionModels: {},
          sessionVariants: {},
          lastViewedAt: {},
          pinnedSessionIds: new Set(),
          sessionNotes: {},
        },
      },
    });

    render(
      <RunningSubAgentsBanner parentSessionId="parent" workspaceId="ws-1" />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: /Review implementation/ }),
    );

    expect(screen.getByRole("dialog")).toHaveTextContent(
      "Review implementation",
    );
  });

  it("loads missing active descendants and shows every one that fits", async () => {
    mockAgentListWidth(1200);
    global.fetch = vi
      .fn()
      .mockImplementation((input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("/session/parent/children")) {
          return Promise.resolve({
            ok: true,
            json: async () => [
              makeSession("running-1", "First running agent", "parent"),
              makeSession("running-2", "Second running agent", "parent"),
              makeSession("running-3", "Third running agent", "parent"),
            ],
          });
        }
        return Promise.resolve({ ok: true, json: async () => [] });
      });
    useChatStore.setState({
      workspaceStates: {
        "ws-1": {
          sessionsLoaded: true,
          sessions: { parent: makeSession("parent", "Parent") },
          messages: {},
          optimisticMessageIds: {},
          sessionStatuses: {
            "running-1": { type: "busy" },
            "running-2": { type: "busy" },
            "running-3": { type: "retry", attempt: 1, message: "", next: 1 },
          },
          permissions: [],
          questions: [],
          todos: {},
          todoUpdatedAt: {},
          sessionAgents: {},
          sessionModels: {},
          sessionVariants: {},
          lastViewedAt: {},
          pinnedSessionIds: new Set(),
          sessionNotes: {},
        },
      },
    });

    render(
      <RunningSubAgentsBanner parentSessionId="parent" workspaceId="ws-1" />,
    );

    expect(await screen.findByText("3 running")).toBeInTheDocument();
    for (const title of [
      "First running agent",
      "Second running agent",
      "Third running agent",
    ]) {
      expect(screen.getByRole("button", { name: title })).toBeInTheDocument();
    }
    expect(
      screen.queryByRole("button", { name: /more/ }),
    ).not.toBeInTheDocument();
  });

  it("moves agents that do not fit into a picker that opens their detail", async () => {
    mockAgentListWidth(500);
    global.fetch = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => [] });
    useChatStore.setState({
      workspaceStates: {
        "ws-1": makeWorkspaceState(
          {
            parent: makeSession("parent", "Parent"),
            newest: makeSession("newest", "Newest agent", "parent", 4),
            newer: makeSession("newer", "Newer agent", "parent", 3),
            older: makeSession("older", "Older agent", "parent", 2),
            oldest: makeSession("oldest", "Oldest agent", "parent", 1),
          },
          {
            newest: { type: "busy" },
            newer: { type: "busy" },
            older: { type: "busy" },
            oldest: { type: "busy" },
          },
        ),
      },
    });
    const user = userEvent.setup();

    render(
      <RunningSubAgentsBanner parentSessionId="parent" workspaceId="ws-1" />,
    );

    expect(
      screen.getByRole("button", { name: "Newest agent" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Newer agent" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Older agent")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "+2 more" }));
    expect(
      screen.getByRole("menuitem", { name: "Older agent" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "Oldest agent" }));

    expect(screen.getByRole("dialog")).toHaveTextContent("Oldest agent");
  });

  it("re-fits the chips when the banner is resized", () => {
    const notifyResize = installControlledResizeObserver();
    const agentListWidth = mockAgentListWidth(300);
    global.fetch = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => [] });
    useChatStore.setState({
      workspaceStates: {
        "ws-1": makeWorkspaceState(
          {
            parent: makeSession("parent", "Parent"),
            first: makeSession("first", "First running agent", "parent", 3),
            second: makeSession("second", "Second running agent", "parent", 2),
            third: makeSession("third", "Third running agent", "parent", 1),
          },
          {
            first: { type: "busy" },
            second: { type: "busy" },
            third: { type: "busy" },
          },
        ),
      },
    });

    render(
      <RunningSubAgentsBanner parentSessionId="parent" workspaceId="ws-1" />,
    );
    expect(
      screen.getAllByRole("button", { name: /running agent/ }),
    ).toHaveLength(1);
    expect(screen.getByRole("button", { name: "+2 more" })).toBeInTheDocument();

    agentListWidth.mockReturnValue(1200);
    act(() => notifyResize());

    expect(
      screen.getAllByRole("button", { name: /running agent/ }),
    ).toHaveLength(3);
    expect(
      screen.queryByRole("button", { name: /more/ }),
    ).not.toBeInTheDocument();
  });

  it("reconciles a stale idle store status with the current server status", async () => {
    const child = makeSession("running", "Current retrying agent", "parent");
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => [child] })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ running: { type: "retry" } }),
      });
    useChatStore.setState({
      workspaceStates: {
        "ws-1": {
          sessionsLoaded: true,
          sessions: { parent: makeSession("parent", "Parent") },
          messages: {},
          optimisticMessageIds: {},
          sessionStatuses: { running: { type: "idle" } },
          permissions: [],
          questions: [],
          todos: {},
          todoUpdatedAt: {},
          sessionAgents: {},
          sessionModels: {},
          sessionVariants: {},
          lastViewedAt: {},
          pinnedSessionIds: new Set<string>(),
          sessionNotes: {},
        },
      },
    });

    render(
      <RunningSubAgentsBanner parentSessionId="parent" workspaceId="ws-1" />,
    );

    expect(
      await screen.findByRole("button", { name: /Current retrying agent/ }),
    ).toBeInTheDocument();
  });

  it("closes selected detail when the agent stops running", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => [] });
    const workspace = {
      sessionsLoaded: true,
      sessions: {
        parent: makeSession("parent", "Parent"),
        running: makeSession("running", "Review implementation", "parent"),
      },
      messages: {},
      optimisticMessageIds: {},
      sessionStatuses: { running: { type: "busy" as const } },
      permissions: [],
      questions: [],
      todos: {},
      todoUpdatedAt: {},
      sessionAgents: {},
      sessionModels: {},
      sessionVariants: {},
      lastViewedAt: {},
      pinnedSessionIds: new Set<string>(),
      sessionNotes: {},
    };
    useChatStore.setState({ workspaceStates: { "ws-1": workspace } });
    render(
      <RunningSubAgentsBanner parentSessionId="parent" workspaceId="ws-1" />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: /Review implementation/ }),
    );

    act(() => {
      useChatStore.setState({
        workspaceStates: {
          "ws-1": {
            ...workspace,
            sessionStatuses: { running: { type: "idle" } },
          },
        },
      });
    });

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });
});

function makeSession(
  id: string,
  title: string,
  parentID?: string,
  updatedAt = 1,
) {
  return {
    id,
    title,
    parentID,
    projectID: "project-1",
    directory: "/tmp",
    version: "1",
    time: { created: 1, updated: updatedAt },
  };
}

function makeWorkspaceState(
  sessions: WorkspaceState["sessions"],
  sessionStatuses: WorkspaceState["sessionStatuses"],
): WorkspaceState {
  return {
    sessionsLoaded: true,
    sessions,
    messages: {},
    optimisticMessageIds: {},
    sessionStatuses,
    permissions: [],
    questions: [],
    todos: {},
    todoUpdatedAt: {},
    sessionAgents: {},
    sessionModels: {},
    sessionVariants: {},
    lastViewedAt: {},
    pinnedSessionIds: new Set<string>(),
    sessionNotes: {},
  };
}

function mockAgentListWidth(width: number) {
  return vi
    .spyOn(Element.prototype, "clientWidth", "get")
    .mockReturnValue(width);
}

function installControlledResizeObserver() {
  const notifyCallbacks: Array<() => void> = [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: ResizeObserverCallback) {
        notifyCallbacks.push(() => callback([], this));
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  return () => notifyCallbacks.forEach((notify) => notify());
}
