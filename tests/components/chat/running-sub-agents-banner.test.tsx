import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RunningSubAgentsBanner } from "@/components/chat/running-sub-agents-banner";
import { useChatStore } from "@/stores/chat-store";

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

  it("loads missing active descendants and compacts overflow into one line", async () => {
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
    expect(screen.getByText("+1 more")).toBeInTheDocument();
    expect(screen.queryByText("Third running agent")).not.toBeInTheDocument();
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

function makeSession(id: string, title: string, parentID?: string) {
  return {
    id,
    title,
    parentID,
    projectID: "project-1",
    directory: "/tmp",
    version: "1",
    time: { created: 1, updated: 1 },
  };
}
