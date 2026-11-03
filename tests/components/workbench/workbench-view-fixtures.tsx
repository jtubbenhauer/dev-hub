import { StrictMode } from "react";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { WorkbenchView } from "@/components/workbench/workbench-view";
import type { WorkspaceState } from "@/stores/chat-store";
import type { Workspace } from "@/types";

export function createWorkspace(id: string): Workspace {
  return {
    id,
    userId: "user-1",
    name: `Workspace ${id}`,
    path: `/home/user/dev/${id}`,
    type: "repo",
    parentRepoPath: null,
    packageManager: "pnpm",
    quickCommands: null,
    backend: "local",
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
    createdAt: new Date("2025-01-01"),
    lastAccessedAt: new Date("2025-01-01"),
  };
}

export function createLoadedChatWorkspaceState(): WorkspaceState {
  return {
    sessions: {},
    sessionsLoaded: true,
    messages: {},
    optimisticMessageIds: {},
    sessionStatuses: {},
    permissions: [],
    questions: [],
    todos: {},
    sessionAgents: {},
    sessionModels: {},
    sessionVariants: {},
    lastViewedAt: {},
    pinnedSessionIds: new Set(),
    sessionNotes: {},
  };
}

// StrictMode mirrors `next dev`, so an intent must survive replayed effects.
export function renderWorkbenchView() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  // Seeded settings keep useFileTabsSetting from fetching mid-test.
  queryClient.setQueryData(["settings"], {});
  return render(
    <QueryClientProvider client={queryClient}>
      <StrictMode>
        <WorkbenchView />
      </StrictMode>
    </QueryClientProvider>,
  );
}

export function terminalCloseButtons(): HTMLElement[] {
  return screen.queryAllByRole("button", { name: /^Close Terminal \d+$/ });
}
