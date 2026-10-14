import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RunningSubAgentsBanner } from "@/components/chat/running-sub-agents-banner";
import type { SubAgentActivity } from "@/lib/opencode/types";
import { useChatStore, type WorkspaceState } from "@/stores/chat-store";
import { useSubAgentActivityStore } from "@/stores/sub-agent-activity-store";

vi.mock("@/components/chat/sub-agent-dialog", () => ({
  SubAgentDialog: () => null,
}));

interface RunningChild {
  readonly id: string;
  readonly title: string;
  readonly updatedAt?: number;
  readonly todos?: WorkspaceState["todos"][string];
}

beforeEach(() => {
  // The banner's own reconcile fetch stays pending so the stores drive the UI.
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise<Response>(() => {})),
  );
});

afterEach(() => {
  cleanup();
  useChatStore.setState({ workspaceStates: {} });
  useSubAgentActivityStore.setState({ activityBySession: {} });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("RunningSubAgentsBanner activity", () => {
  it("shows a busy sub-agent's current tool beside its title", () => {
    seedRunningChildren([
      {
        id: "child",
        title: "Review implementation",
        todos: [
          { id: "1", content: "Read", status: "completed", priority: "high" },
          { id: "2", content: "Report", status: "pending", priority: "low" },
        ],
      },
    ]);
    publishActivity("child", {
      summary: "Reviewing the auth changes",
      currentTool: "read",
      lastLine: "Checking the session cookie handler",
      turns: 3,
      toolCalls: 5,
      updatedAt: 1,
    });

    render(
      <RunningSubAgentsBanner parentSessionId="parent" workspaceId="ws-1" />,
    );

    const chip = screen.getByRole("button", { name: /Review implementation/ });
    expect(within(chip).getByText("read")).toHaveClass(
      "text-muted-foreground",
      "min-w-0",
      "truncate",
    );
    expect(
      within(chip).queryByText("Checking the session cookie handler"),
    ).not.toBeInTheDocument();
    expect(chip).toHaveAttribute(
      "title",
      "Reviewing the auth changes\nChecking the session cookie handler",
    );
    expect(chip).toHaveClass("max-w-64", "min-w-0");
    expect(within(chip).getByText("1/2")).toBeInTheDocument();
  });

  it("falls back to the last line when no tool is running", () => {
    seedRunningChildren([{ id: "child", title: "Review implementation" }]);
    publishActivity("child", {
      summary: "Reviewing the auth changes",
      lastLine: "Writing up the findings",
      turns: 4,
      updatedAt: 2,
    });

    render(
      <RunningSubAgentsBanner parentSessionId="parent" workspaceId="ws-1" />,
    );

    const chip = screen.getByRole("button", { name: /Review implementation/ });
    expect(within(chip).getByText("Writing up the findings")).toHaveClass(
      "truncate",
    );
    expect(chip).toHaveAttribute(
      "title",
      "Reviewing the auth changes\nWriting up the findings",
    );
  });

  it("adds activity only once it arrives and keeps it live", () => {
    seedRunningChildren([{ id: "child", title: "Review implementation" }]);
    render(
      <RunningSubAgentsBanner parentSessionId="parent" workspaceId="ws-1" />,
    );
    const chip = screen.getByRole("button", { name: "Review implementation" });
    expect(chip).not.toHaveAttribute("title");

    publishActivity("child", {
      summary: "Starting up",
      turns: 0,
      updatedAt: 1,
    });
    expect(chip).toHaveAttribute("title", "Starting up");
    expect(chip).toHaveAccessibleName("Review implementation");

    publishActivity("child", {
      summary: "Running the checks",
      currentTool: "bash",
      turns: 1,
      updatedAt: 2,
    });
    expect(within(chip).getByText("bash")).toBeInTheDocument();
    expect(chip).toHaveAttribute("title", "Running the checks");
  });

  it("shows activity for agents in the overflow picker", async () => {
    vi.spyOn(Element.prototype, "clientWidth", "get").mockReturnValue(500);
    seedRunningChildren([
      { id: "newest", title: "Newest agent", updatedAt: 4 },
      { id: "newer", title: "Newer agent", updatedAt: 3 },
      { id: "older", title: "Older agent", updatedAt: 2 },
      { id: "oldest", title: "Oldest agent", updatedAt: 1 },
    ]);
    publishActivity("oldest", {
      summary: "Searching for usages",
      currentTool: "grep",
      lastLine: "Found 12 matches",
      turns: 2,
      updatedAt: 1,
    });
    const user = userEvent.setup();

    render(
      <RunningSubAgentsBanner parentSessionId="parent" workspaceId="ws-1" />,
    );
    await user.click(screen.getByRole("button", { name: "+2 more" }));

    const item = screen.getByRole("menuitem", { name: /Oldest agent/ });
    expect(within(item).getByText("grep")).toHaveClass("truncate");
    expect(item).toHaveAttribute(
      "title",
      "Searching for usages\nFound 12 matches",
    );
    expect(
      screen.getByRole("menuitem", { name: "Older agent" }),
    ).not.toHaveAttribute("title");
  });
});

function publishActivity(sessionId: string, activity: SubAgentActivity) {
  act(() => {
    useSubAgentActivityStore.getState().handleEvent({
      type: "session.activity",
      properties: { sessionID: sessionId, activity },
    });
  });
}

function seedRunningChildren(children: readonly RunningChild[]) {
  const sessions: WorkspaceState["sessions"] = {
    parent: makeSession("parent", "Parent"),
  };
  const sessionStatuses: WorkspaceState["sessionStatuses"] = {};
  const todos: WorkspaceState["todos"] = {};
  for (const child of children) {
    sessions[child.id] = makeSession(
      child.id,
      child.title,
      "parent",
      child.updatedAt,
    );
    sessionStatuses[child.id] = { type: "busy" };
    todos[child.id] = child.todos ?? [];
  }
  useChatStore.setState({
    workspaceStates: {
      "ws-1": {
        sessionsLoaded: true,
        sessions,
        messages: {},
        optimisticMessageIds: {},
        sessionStatuses,
        permissions: [],
        questions: [],
        todos,
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
}

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
