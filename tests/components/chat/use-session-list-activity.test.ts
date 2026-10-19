import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useSessionListActivity } from "@/components/chat/use-session-list-activity";
import { buildChildSessionIndex } from "@/lib/chat/descendant-activity";
import type { Session } from "@/lib/opencode/types";
import { useChatStore, type WorkspaceState } from "@/stores/chat-store";

vi.mock("@/lib/chat/descendant-activity", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/chat/descendant-activity")>();
  return {
    ...actual,
    buildChildSessionIndex: vi.fn(actual.buildChildSessionIndex),
  };
});

function makeSession(id: string, parentID?: string): Session {
  return {
    id,
    parentID,
    projectID: "project",
    directory: "/workspace",
    title: id,
    version: "1",
    time: { created: 1, updated: 1 },
  };
}

function makeWorkspace(overrides: Partial<WorkspaceState>): WorkspaceState {
  return {
    sessionsLoaded: true,
    sessions: {},
    messages: {},
    optimisticMessageIds: {},
    sessionStatuses: {},
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
    ...overrides,
  };
}

function workspaceWithBusySubAgent(): WorkspaceState {
  return makeWorkspace({
    sessions: {
      root: makeSession("root"),
      child: makeSession("child", "root"),
      quiet: makeSession("quiet"),
    },
    sessionStatuses: { child: { type: "busy" } },
    todos: {
      child: [
        { id: "1", content: "Read", status: "completed", priority: "high" },
        { id: "2", content: "Report", status: "pending", priority: "low" },
      ],
    },
  });
}

function updateWorkspace(workspaceId: string, update: Partial<WorkspaceState>) {
  act(() => {
    useChatStore.setState((state) => ({
      workspaceStates: {
        ...state.workspaceStates,
        [workspaceId]: { ...state.workspaceStates[workspaceId], ...update },
      },
    }));
  });
}

afterEach(() => {
  cleanup();
  useChatStore.setState({ workspaceStates: {} });
});

describe("useSessionListActivity", () => {
  it("marks a chat with a busy sub-agent active and counts that sub-agent's todos", () => {
    // Given
    useChatStore.setState({
      workspaceStates: { "ws-a": workspaceWithBusySubAgent() },
    });

    // When
    const { result } = renderHook(() =>
      useSessionListActivity({
        isUnifiedMode: false,
        activeWorkspaceId: "ws-a",
      }),
    );

    // Then
    expect(result.current.taskActiveSessionIds).toEqual(new Set(["root"]));
    expect(result.current.subAgentCountBySessionId).toEqual({
      root: { active: 1, waiting: 0, progress: { completed: 1, total: 2 } },
    });
    expect(result.current.taskProgressBySessionId).toEqual({
      child: { completed: 1, total: 2, updatedAt: 1 },
    });
  });

  it("returns the same summaries when only messages change", () => {
    // Given
    useChatStore.setState({
      workspaceStates: { "ws-a": workspaceWithBusySubAgent() },
    });
    const { result } = renderHook(() =>
      useSessionListActivity({
        isUnifiedMode: false,
        activeWorkspaceId: "ws-a",
      }),
    );
    const before = result.current;

    // When
    updateWorkspace("ws-a", { messages: { root: [] } });

    // Then
    expect(result.current.taskActiveSessionIds).toBe(
      before.taskActiveSessionIds,
    );
    expect(result.current.subAgentCountBySessionId).toBe(
      before.subAgentCountBySessionId,
    );
    expect(result.current.taskProgressBySessionId).toBe(
      before.taskProgressBySessionId,
    );
  });

  it("recomputes when a sub-agent's status changes", () => {
    // Given
    useChatStore.setState({
      workspaceStates: { "ws-a": workspaceWithBusySubAgent() },
    });
    const { result } = renderHook(() =>
      useSessionListActivity({
        isUnifiedMode: false,
        activeWorkspaceId: "ws-a",
      }),
    );

    // When
    updateWorkspace("ws-a", { sessionStatuses: { child: { type: "idle" } } });

    // Then
    expect(result.current.taskActiveSessionIds).toEqual(new Set());
  });

  it("summarizes only the active workspace outside unified mode", () => {
    // Given
    useChatStore.setState({
      workspaceStates: {
        "ws-a": makeWorkspace({}),
        "ws-b": workspaceWithBusySubAgent(),
      },
    });

    // When
    const { result } = renderHook(() =>
      useSessionListActivity({
        isUnifiedMode: false,
        activeWorkspaceId: "ws-a",
      }),
    );

    // Then
    expect(result.current.taskActiveSessionIds).toEqual(new Set());
  });

  it("summarizes every workspace in unified mode", () => {
    // Given
    useChatStore.setState({
      workspaceStates: {
        "ws-a": makeWorkspace({}),
        "ws-b": workspaceWithBusySubAgent(),
      },
    });

    // When
    const { result } = renderHook(() =>
      useSessionListActivity({
        isUnifiedMode: true,
        activeWorkspaceId: "ws-a",
      }),
    );

    // Then
    expect(result.current.taskActiveSessionIds).toEqual(new Set(["root"]));
  });

  it("keeps a session's progress object when another session's todos change", () => {
    // Given
    useChatStore.setState({
      workspaceStates: {
        "ws-a": makeWorkspace({
          sessions: { a: makeSession("a"), b: makeSession("b") },
          todos: {
            a: [
              {
                id: "1",
                content: "Read",
                status: "completed",
                priority: "high",
              },
            ],
            b: [
              {
                id: "2",
                content: "Report",
                status: "pending",
                priority: "low",
              },
            ],
          },
        }),
      },
    });
    const { result } = renderHook(() =>
      useSessionListActivity({
        isUnifiedMode: false,
        activeWorkspaceId: "ws-a",
      }),
    );
    const progressOfA = result.current.taskProgressBySessionId.a;

    // When
    updateWorkspace("ws-a", {
      todos: {
        a: [
          { id: "1", content: "Read", status: "completed", priority: "high" },
        ],
        b: [
          { id: "2", content: "Report", status: "completed", priority: "low" },
        ],
      },
    });

    // Then
    expect(result.current.taskProgressBySessionId.a).toBe(progressOfA);
    expect(result.current.taskProgressBySessionId.b).toEqual({
      completed: 1,
      total: 1,
      updatedAt: 1,
    });
  });

  it("keeps a chat's sub-agent count object when its numbers stay the same", () => {
    // Given
    useChatStore.setState({
      workspaceStates: { "ws-a": workspaceWithBusySubAgent() },
    });
    const { result } = renderHook(() =>
      useSessionListActivity({
        isUnifiedMode: false,
        activeWorkspaceId: "ws-a",
      }),
    );
    const countOfRoot = result.current.subAgentCountBySessionId.root;

    // When
    const { sessions } = useChatStore.getState().workspaceStates["ws-a"];
    updateWorkspace("ws-a", {
      sessions: { ...sessions, child: makeSession("child", "root") },
    });

    // Then
    expect(result.current.subAgentCountBySessionId.root).toBe(countOfRoot);
  });

  it("re-walks only the workspace that changed in unified mode", () => {
    // Given
    useChatStore.setState({
      workspaceStates: {
        "ws-a": workspaceWithBusySubAgent(),
        "ws-b": workspaceWithBusySubAgent(),
      },
    });
    renderHook(() =>
      useSessionListActivity({
        isUnifiedMode: true,
        activeWorkspaceId: "ws-a",
      }),
    );
    vi.mocked(buildChildSessionIndex).mockClear();

    // When
    updateWorkspace("ws-b", { sessionStatuses: { child: { type: "idle" } } });

    // Then
    expect(buildChildSessionIndex).toHaveBeenCalledTimes(1);
  });
});
