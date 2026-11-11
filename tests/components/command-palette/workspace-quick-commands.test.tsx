import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { useEffect } from "react";
import { WorkspaceQuickCommands } from "@/components/command-palette/workspace-quick-commands";
import {
  CommandPaletteProvider,
  useCommandPalette,
  type PaletteCommand,
} from "@/components/providers/command-palette-provider";
import { useCommandStore } from "@/stores/command-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { QuickCommand, Workspace } from "@/types";

function makeWorkspace(
  id: string,
  quickCommands: QuickCommand[] | null,
): Workspace {
  return {
    id,
    userId: "user-1",
    name: id,
    path: `/code/${id}`,
    type: "repo",
    parentRepoPath: null,
    packageManager: "pnpm",
    quickCommands,
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

function renderQuickCommands() {
  render(
    <CommandPaletteProvider>
      <WorkspaceQuickCommands />
      <CommandsProbe />
    </CommandPaletteProvider>,
  );
}

const runCommand = vi.fn(() => "session-1");
const setDrawerOpen = vi.fn();
const initialCommandStore = useCommandStore.getState();

beforeEach(() => {
  useCommandStore.setState({ runCommand, setDrawerOpen });
  useWorkspaceStore.setState({
    workspaces: [
      makeWorkspace("ws-1", [
        { label: "Dev server", command: "pnpm dev" },
        { label: "Tests", command: "pnpm test" },
      ]),
      makeWorkspace("ws-2", [{ label: "Build", command: "cargo build" }]),
    ],
    activeWorkspaceId: "ws-1",
  });
});

afterEach(() => {
  useCommandStore.setState(initialCommandStore, true);
  runCommand.mockClear();
  setDrawerOpen.mockClear();
  registeredCommands = [];
});

describe("WorkspaceQuickCommands", () => {
  it("lists the active workspace's quick commands under Run with their command text", () => {
    // When
    renderQuickCommands();

    // Then
    expect(
      registeredCommands.map(({ label, group, detail }) => ({
        label,
        group,
        detail,
      })),
    ).toEqual([
      { label: "Dev server", group: "Run", detail: "pnpm dev" },
      { label: "Tests", group: "Run", detail: "pnpm test" },
    ]);
  });

  it("runs the picked command in the active workspace and shows the runner", () => {
    // Given
    renderQuickCommands();

    // When
    act(() =>
      registeredCommands
        .find((command) => command.label === "Tests")
        ?.onSelect(),
    );

    // Then
    expect(runCommand).toHaveBeenCalledExactlyOnceWith("pnpm test", "ws-1");
    expect(setDrawerOpen).toHaveBeenCalledExactlyOnceWith(true);
  });

  it("swaps in the new workspace's commands when the active workspace changes", () => {
    // Given
    renderQuickCommands();

    // When
    act(() => useWorkspaceStore.setState({ activeWorkspaceId: "ws-2" }));

    // Then
    expect(registeredCommands.map((command) => command.label)).toEqual([
      "Build",
    ]);
  });
});
