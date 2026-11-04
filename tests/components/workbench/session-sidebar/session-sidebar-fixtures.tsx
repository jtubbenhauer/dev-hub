import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Session } from "@/lib/opencode/types";
import { useChatStore, type WorkspaceState } from "@/stores/chat-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { Workspace } from "@/types";

HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
HTMLElement.prototype.releasePointerCapture = vi.fn();

class MockPointerEvent extends Event {
  button: number;
  ctrlKey: boolean;
  pointerType: string;

  constructor(type: string, props: PointerEventInit) {
    super(type, props);
    this.button = props.button || 0;
    this.ctrlKey = props.ctrlKey || false;
    this.pointerType = props.pointerType || "mouse";
  }
}
window.PointerEvent = MockPointerEvent as unknown as typeof PointerEvent;

export function makeWorkspace(
  id: string,
  backend: Workspace["backend"] = "local",
): Workspace {
  return {
    id,
    userId: "user-1",
    name: id,
    path: `/workspaces/${id}`,
    type: "repo",
    parentRepoPath: null,
    packageManager: null,
    quickCommands: null,
    backend,
    provider: null,
    opencodeUrl: null,
    agentUrl: null,
    providerMeta: null,
    shellCommand: null,
    sshTarget: null,
    sshPath: null,
    worktreeSymlinks: null,
    linkedTaskId: null,
    linkedTaskMeta: null,
    color: null,
    createdAt: new Date(0),
    lastAccessedAt: new Date(0),
  };
}

export function makeSession(
  id: string,
  title: string,
  updated: number,
): Session {
  return {
    id,
    projectID: "project",
    directory: "/workspace",
    title,
    version: "1",
    time: { created: updated, updated },
  };
}

function workspaceState(overrides: Partial<WorkspaceState>): WorkspaceState {
  return {
    sessions: {},
    sessionsLoaded: true,
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
    pinnedSessionIds: new Set(),
    sessionNotes: {},
    ...overrides,
  };
}

export const chatStoreStubs = {
  createSession: vi.fn(async (_workspaceId: string) =>
    makeSession("s3", "New chat", 30),
  ),
  setActiveSession: vi.fn(),
  setActiveWorkspaceSession: vi.fn(),
  fetchMessages: vi.fn(async () => {}),
  fetchSessionTodos: vi.fn(async () => {}),
  fetchSessions: vi.fn(async () => {}),
  fetchCachedSessions: vi.fn(async () => {}),
  fetchPinnedSessions: vi.fn(async () => {}),
  fetchSessionNotes: vi.fn(async () => {}),
};

export function seedSessionStores(input?: {
  w2Backend?: Workspace["backend"];
}) {
  useWorkspaceStore.setState({
    workspaces: [
      makeWorkspace("w1"),
      makeWorkspace("w2", input?.w2Backend ?? "local"),
    ],
    activeWorkspaceId: "w1",
  });
  useChatStore.setState({
    ...chatStoreStubs,
    activeWorkspaceId: "w1",
    activeSessionId: null,
    workspaceStates: {
      w1: workspaceState({
        sessions: {
          s1: makeSession("s1", "First chat", 20),
          s2: makeSession("s2", "Second chat", 10),
        },
      }),
      w2: workspaceState({
        sessions: { s5: makeSession("s5", "Other workspace chat", 15) },
      }),
    },
  });
}

export function renderWithProviders(children: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>{children}</TooltipProvider>
    </QueryClientProvider>,
  );
}

export function sessionRow(sessionId: string): HTMLElement {
  const row = document.querySelector<HTMLElement>(
    `[data-session-id="${sessionId}"]`,
  );
  if (!row) throw new Error(`no session row for ${sessionId}`);
  return row;
}
