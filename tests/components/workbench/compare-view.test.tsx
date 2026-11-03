import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { TooltipProvider } from "@/components/ui/tooltip";
import { ContextSidebarContent } from "@/components/workbench/context-sidebar/context-sidebar-content";
import { useContextSidebarStore } from "@/stores/context-sidebar-store";
import { mountFakeWorkbench } from "@/tests/helpers/fake-workbench-controller";
import type { GitBranch, ReviewChangedFile } from "@/types";
import { createWorkspace } from "./workspace-fixture";

function makeBranch(name: string, current: boolean): GitBranch {
  return { name, current, commit: "abc", label: "", linkedWorkTree: false };
}

vi.mock("@/hooks/use-git", () => {
  const changedFiles: ReviewChangedFile[] = [
    { path: "a.ts", status: "modified", additions: 1, deletions: 1 },
  ];
  return {
    // No main/master to fall back on, so a file list proves the stored base.
    useGitBranches: () => ({
      data: [makeBranch("master", true), makeBranch("qa-base", false)],
      isLoading: false,
    }),
    useGitChangedFiles: () => ({
      data: changedFiles,
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    }),
  };
});

const WORKSPACE_ID = "ws-1";

function renderCompareView() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  queryClient.setQueryData(["settings"], {});
  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ContextSidebarContent
          view="compare"
          workspaceId={WORKSPACE_ID}
          workspace={createWorkspace(WORKSPACE_ID)}
        />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

let workbench: ReturnType<typeof mountFakeWorkbench>;

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise<Response>(() => {})),
  );
  useContextSidebarStore.setState(
    useContextSidebarStore.getInitialState(),
    true,
  );
  workbench = mountFakeWorkbench(WORKSPACE_ID);
});

afterEach(() => {
  cleanup();
  workbench.unmount();
  vi.unstubAllGlobals();
});

describe("Compare view", () => {
  it("opens a compare diff tab against the stored base branch for a clicked file", async () => {
    // Given
    useContextSidebarStore
      .getState()
      .setBranchCompareBaseRef(WORKSPACE_ID, "qa-base");
    renderCompareView();

    // When
    await userEvent.setup().click(screen.getByText("a.ts"));

    // Then
    expect(workbench.controller.openTab).toHaveBeenCalledExactlyOnceWith({
      kind: "diff",
      workspaceId: WORKSPACE_ID,
      path: "a.ts",
      source: "compare",
      baseRef: "qa-base",
    });
  });
});
