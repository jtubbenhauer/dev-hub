import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  FilePickerDialog,
  FilePickerProvider,
  useFilePicker,
} from "@/components/file-picker/file-picker";
import type { OpenFileInWorkbenchInput } from "@/lib/workbench/open-in-workbench";
import { WORKBENCH_PATH } from "@/lib/workbench/workbench-href";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { Workspace } from "@/types";

const hoisted = vi.hoisted(() => ({
  routerPush: vi.fn<(href: string) => void>(),
  openFileInWorkbench: vi.fn<
    (input: OpenFileInWorkbenchInput) => Promise<boolean>
  >(async () => true),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: hoisted.routerPush }),
}));
vi.mock("@/hooks/use-settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-settings")>()),
  useFileTabsSetting: () => ({ isFileTabsDisabled: true, isLoading: false }),
}));
vi.mock("@/lib/workbench/open-in-workbench", () => ({
  openFileInWorkbench: hoisted.openFileInWorkbench,
}));

function createWorkspace(id: string, name: string): Workspace {
  return {
    id,
    userId: "user-1",
    name,
    path: `/repos/${name}`,
    type: "repo",
    parentRepoPath: null,
    packageManager: null,
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
    createdAt: new Date(0),
    lastAccessedAt: new Date(0),
  };
}

function OpenPickerButton() {
  const { open } = useFilePicker();
  return (
    <button type="button" onClick={open}>
      Open picker
    </button>
  );
}

async function openPicker() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  queryClient.setQueryData(["workspace-files", "ws-1"], ["src/a.ts", "b.md"]);
  queryClient.setQueryData(["workspace-files", "ws-2"], ["src/a.ts"]);
  render(
    <QueryClientProvider client={queryClient}>
      <FilePickerProvider>
        <OpenPickerButton />
        <FilePickerDialog />
      </FilePickerProvider>
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Open picker" }));
  return user;
}

async function openPickerAndSearch(query: string) {
  const user = await openPicker();
  await user.type(screen.getByPlaceholderText("Find file..."), query);
  return user;
}

beforeEach(() => {
  vi.clearAllMocks();
  useWorkspaceStore.setState({
    workspaces: [
      createWorkspace("ws-1", "one"),
      createWorkspace("ws-2", "two"),
    ],
    activeWorkspaceId: "ws-1",
  });
});

afterEach(() => {
  cleanup();
});

describe("FilePickerDialog opening a file", () => {
  it.each([
    ["Enter", "{Enter}"],
    ["Cmd+Enter", "{Meta>}{Enter}{/Meta}"],
  ])("opens the picked file as a workbench tab on %s", async (_label, keys) => {
    // Given
    const user = await openPickerAndSearch("a.ts");

    // When
    await user.keyboard(keys);

    // Then
    expect(hoisted.openFileInWorkbench).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        workspaceId: "ws-1",
        path: "src/a.ts",
        isFileTabsDisabled: true,
      }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(hoisted.routerPush).not.toHaveBeenCalled();
  });

  it("opens a clicked file as a workbench tab", async () => {
    // Given
    const user = await openPickerAndSearch("a.ts");

    // When
    await user.click(screen.getByRole("button", { name: /a\.ts/ }));

    // Then
    expect(hoisted.openFileInWorkbench).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ workspaceId: "ws-1", path: "src/a.ts" }),
    );
  });

  it("switches to the picker's workspace before opening its file", async () => {
    // Given
    const user = await openPicker();
    await user.keyboard("{Tab}");
    await user.type(screen.getByPlaceholderText("Find file..."), "a.ts");

    // When
    await user.keyboard("{Enter}");

    // Then
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe("ws-2");
    expect(hoisted.openFileInWorkbench).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ workspaceId: "ws-2", path: "src/a.ts" }),
    );
  });

  it("routes the opener's navigation through the router", async () => {
    // Given
    const user = await openPickerAndSearch("a.ts");
    await user.keyboard("{Enter}");

    // When
    hoisted.openFileInWorkbench.mock.lastCall?.[0].navigate(
      `${WORKBENCH_PATH}?x=1`,
    );

    // Then
    expect(hoisted.routerPush).toHaveBeenCalledExactlyOnceWith(
      `${WORKBENCH_PATH}?x=1`,
    );
  });
});
