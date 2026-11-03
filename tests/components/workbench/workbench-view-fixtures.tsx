import { StrictMode } from "react";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { WorkbenchView } from "@/components/workbench/workbench-view";
import type { WorkspaceState } from "@/stores/chat-store";

export { createWorkspace } from "./workspace-fixture";

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
