import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { useEffect } from "react";
import { AppCommands } from "@/components/command-palette/app-commands";
import {
  CommandPaletteProvider,
  useCommandPalette,
  type PaletteCommand,
} from "@/components/providers/command-palette-provider";
import type { OpenWorkspaceTabInWorkbenchInput } from "@/lib/workbench/open-in-workbench";
import { useNewChatEngineStore } from "@/stores/new-chat-engine-store";
import { useWorkspaceDialogStore } from "@/stores/workspace-dialog-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { Workspace } from "@/types";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

const workbenchOpeners = vi.hoisted(() => ({
  createNewChatInWorkbench: vi.fn<
    (input: OpenWorkspaceTabInWorkbenchInput) => Promise<void>
  >(async () => {}),
  openTerminalInWorkbench:
    vi.fn<(input: OpenWorkspaceTabInWorkbenchInput) => void>(),
}));
vi.mock("@/lib/workbench/open-in-workbench", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/lib/workbench/open-in-workbench")
  >()),
  ...workbenchOpeners,
}));

function makeWorkspace(
  id: string,
  path: string,
  worktreeOf: string | null = null,
): Workspace {
  return {
    id,
    userId: "user-1",
    name: id,
    path,
    type: worktreeOf === null ? "repo" : "worktree",
    parentRepoPath: worktreeOf,
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

let registeredCommands: PaletteCommand[] = [];

function CommandsProbe() {
  const { commands } = useCommandPalette();
  useEffect(() => {
    registeredCommands = commands;
  }, [commands]);
  return null;
}

function runCommand(commandId: string) {
  const command = registeredCommands.find(
    (candidate) => candidate.id === commandId,
  );
  if (!command) throw new Error(`${commandId} was never registered`);
  act(() => command.onSelect());
}

beforeEach(() => {
  useWorkspaceStore.setState({
    workspaces: [
      makeWorkspace("dev-hub", "/code/dev-hub"),
      makeWorkspace(
        "feature",
        "/code/dev-hub-worktrees/feature",
        "/code/dev-hub",
      ),
    ],
    activeWorkspaceId: "feature",
  });
  render(
    <CommandPaletteProvider>
      <AppCommands />
      <CommandsProbe />
    </CommandPaletteProvider>,
  );
});

afterEach(() => {
  act(() => useWorkspaceDialogStore.getState().close());
  useNewChatEngineStore.setState({ engineByWorkspace: {} });
  vi.clearAllMocks();
});

describe("AppCommands", () => {
  it("opens the worktree dialog on the repo of the active worktree", () => {
    // When
    runCommand("workspace:create-worktree");

    // Then
    expect(useWorkspaceDialogStore.getState().openDialog).toEqual({
      kind: "create-worktree",
      initialRepoId: "dev-hub",
    });
  });

  it.each([
    { commandId: "workspace:add-workspace", kind: "add-workspace" },
    { commandId: "workspace:clone-repo", kind: "clone-repo" },
    { commandId: "workspace:connect-remote", kind: "connect-remote" },
  ])("opens the $kind dialog from $commandId", ({ commandId, kind }) => {
    // When
    runCommand(commandId);

    // Then
    expect(useWorkspaceDialogStore.getState().openDialog).toEqual({ kind });
  });

  it.each(["opencode", "omo"] as const)(
    "creates a new %s chat in the active workspace",
    (engine) => {
      // When
      runCommand(`workbench:new-chat:${engine}`);

      // Then
      expect(useNewChatEngineStore.getState().engineByWorkspace).toEqual({
        feature: engine,
      });
      expect(
        workbenchOpeners.createNewChatInWorkbench.mock.lastCall?.[0]
          .workspaceId,
      ).toBe("feature");
    },
  );

  it("creates a new chat in the active workspace", () => {
    // When
    runCommand("workbench:new-chat");

    // Then
    expect(
      workbenchOpeners.createNewChatInWorkbench.mock.lastCall?.[0].workspaceId,
    ).toBe("feature");
  });

  it("opens a new terminal in the active workspace through the router", () => {
    // Given
    runCommand("workbench:new-terminal");
    const input = workbenchOpeners.openTerminalInWorkbench.mock.lastCall?.[0];

    // When
    input?.navigate("/?open=terminal");

    // Then
    expect(input?.workspaceId).toBe("feature");
    expect(pushMock).toHaveBeenCalledExactlyOnceWith("/?open=terminal");
  });
});
