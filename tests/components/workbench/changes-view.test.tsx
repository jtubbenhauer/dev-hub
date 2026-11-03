import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { TooltipProvider } from "@/components/ui/tooltip";
import { ContextSidebarContent } from "@/components/workbench/context-sidebar/context-sidebar-content";
import { mountFakeWorkbench } from "@/tests/helpers/fake-workbench-controller";
import type { GitStatusResult } from "@/types";
import { createWorkspace } from "./workspace-fixture";

const gitStatus = vi.hoisted(() => ({
  useGitStatus:
    vi.fn<(workspaceId: string) => { data: GitStatusResult | undefined }>(),
}));

vi.mock("@/hooks/use-git", () => {
  const idleMutation = () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
  });
  return {
    useGitStatus: gitStatus.useGitStatus,
    useGitFileDiffs: () => new Map(),
    useGitStage: idleMutation,
    useGitUnstage: idleMutation,
    useGitCommit: idleMutation,
    useGitPush: idleMutation,
    useGitPull: idleMutation,
    useGitDiscard: idleMutation,
  };
});

const WORKSPACE_ID = "ws-1";

function makeStatus(overrides: Partial<GitStatusResult>): GitStatusResult {
  return {
    isRepo: true,
    branch: "master",
    tracking: null,
    ahead: 0,
    behind: 0,
    staged: [],
    unstaged: [],
    untracked: [],
    conflicted: [],
    lastCommit: null,
    ...overrides,
  };
}

function renderChangesView() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  queryClient.setQueryData(["settings"], {});
  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ContextSidebarContent
          view="changes"
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
  gitStatus.useGitStatus.mockReturnValue({
    data: makeStatus({
      staged: [{ path: "b.ts", index: "M", workingDir: " " }],
      unstaged: [{ path: "a.ts", index: " ", workingDir: "M" }],
    }),
  });
  workbench = mountFakeWorkbench(WORKSPACE_ID);
});

afterEach(() => {
  cleanup();
  workbench.unmount();
  vi.unstubAllGlobals();
});

describe("Changes view", () => {
  it("opens a working diff tab for a clicked unstaged file", async () => {
    // Given
    renderChangesView();

    // When
    await userEvent.setup().click(screen.getByText("a.ts"));

    // Then
    expect(workbench.controller.openTab).toHaveBeenCalledExactlyOnceWith({
      kind: "diff",
      workspaceId: WORKSPACE_ID,
      path: "a.ts",
      source: "working",
      baseRef: null,
    });
  });

  it("opens a staged diff tab for a clicked staged file", async () => {
    // Given
    renderChangesView();

    // When
    await userEvent.setup().click(screen.getByText("b.ts"));

    // Then
    expect(workbench.controller.openTab).toHaveBeenCalledExactlyOnceWith({
      kind: "diff",
      workspaceId: WORKSPACE_ID,
      path: "b.ts",
      source: "staged",
      baseRef: null,
    });
  });
});
