import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  GitPickerDialog,
  GitPickerProvider,
  useGitPicker,
} from "@/components/git-picker/git-picker";
import type { OpenFileInWorkbenchInput } from "@/lib/workbench/open-in-workbench";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { GitStatusResult } from "@/types";

const hoisted = vi.hoisted(() => {
  const gitStatus: GitStatusResult = {
    isRepo: true,
    branch: "main",
    tracking: null,
    ahead: 0,
    behind: 0,
    staged: [],
    unstaged: [{ path: "a.ts", index: " ", workingDir: "M" }],
    untracked: [],
    conflicted: [],
    lastCommit: null,
  };
  return {
    gitStatus,
    routerPush: vi.fn<(href: string) => void>(),
    openFileInWorkbench: vi.fn<
      (input: OpenFileInWorkbenchInput) => Promise<boolean>
    >(async () => true),
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: hoisted.routerPush }),
  usePathname: () => "/git",
}));
vi.mock("@/hooks/use-git", () => ({
  useGitStatus: () => ({ data: hoisted.gitStatus, isLoading: false }),
  useGitChangedFiles: () => ({ data: [], isLoading: false }),
  useGitBranches: () => ({ data: [] }),
}));
vi.mock("@/hooks/use-settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-settings")>()),
  useFileTabsSetting: () => ({ isFileTabsDisabled: true, isLoading: false }),
}));
vi.mock("@/lib/workbench/open-in-workbench", () => ({
  openFileInWorkbench: hoisted.openFileInWorkbench,
}));

function OpenPickerButton() {
  const { open } = useGitPicker();
  return (
    <button type="button" onClick={open}>
      Open git picker
    </button>
  );
}

async function openPicker() {
  render(
    <GitPickerProvider>
      <OpenPickerButton />
      <GitPickerDialog />
    </GitPickerProvider>,
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Open git picker" }));
  const input = screen.getByPlaceholderText("Search changed files...");
  await waitFor(() => expect(input).toHaveFocus());
  return user;
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useWorkspaceStore.setState({ activeWorkspaceId: "ws-1" });
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("GitPickerDialog opening a changed file", () => {
  it("opens the file as a workbench tab on Ctrl+Enter", async () => {
    // Given
    const user = await openPicker();
    const selectFile = vi.fn();
    window.addEventListener("devhub:git-select-file", selectFile);

    // When
    await user.keyboard("{Control>}{Enter}{/Control}");

    // Then
    expect(hoisted.openFileInWorkbench).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        workspaceId: "ws-1",
        path: "a.ts",
        isFileTabsDisabled: true,
      }),
    );
    expect(selectFile).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    window.removeEventListener("devhub:git-select-file", selectFile);
  });

  it("routes the opener's navigation through the router", async () => {
    // Given
    const user = await openPicker();
    await user.keyboard("{Control>}{Enter}{/Control}");

    // When
    hoisted.openFileInWorkbench.mock.lastCall?.[0].navigate("/workbench?x=1");

    // Then
    expect(hoisted.routerPush).toHaveBeenCalledExactlyOnceWith(
      "/workbench?x=1",
    );
  });

  it("keeps Enter selecting the file on the git page", async () => {
    // Given
    const user = await openPicker();
    const selectFile = vi.fn<(event: Event) => void>();
    window.addEventListener("devhub:git-select-file", selectFile);

    // When
    await user.keyboard("{Enter}");

    // Then
    expect(selectFile).toHaveBeenCalledOnce();
    expect(localStorage.getItem("dev-hub:git-picker-selected-file")).toBe(
      "a.ts",
    );
    expect(hoisted.openFileInWorkbench).not.toHaveBeenCalled();
    expect(hoisted.routerPush).not.toHaveBeenCalled();
    window.removeEventListener("devhub:git-select-file", selectFile);
  });
});
