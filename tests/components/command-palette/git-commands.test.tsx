import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect } from "react";
import { GitCommands } from "@/components/command-palette/git-commands";
import {
  CommandPaletteProvider,
  useCommandPalette,
  type PaletteCommand,
} from "@/components/providers/command-palette-provider";
import { useWorkspaceStore } from "@/stores/workspace-store";

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

function renderGitCommands() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <CommandPaletteProvider>
        <GitCommands />
        <CommandsProbe />
      </CommandPaletteProvider>
    </QueryClientProvider>,
  );
}

const fetchMock = vi.fn(async () => Response.json({ success: true }));

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  useWorkspaceStore.setState({ activeWorkspaceId: "ws-1" });
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockClear();
  registeredCommands = [];
});

describe("GitCommands", () => {
  it.each([
    { commandId: "git:fetch", action: "fetch" },
    { commandId: "git:pull", action: "pull" },
    { commandId: "git:push", action: "push" },
  ])(
    "runs $action for the active workspace from $commandId",
    async ({ commandId, action }) => {
      // Given
      renderGitCommands();

      // When
      runCommand(commandId);

      // Then
      await waitFor(() =>
        expect(fetchMock).toHaveBeenCalledWith("/api/workspaces/ws-1/git", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        }),
      );
    },
  );

  it("acts on the workspace that is active when the command runs", async () => {
    // Given
    renderGitCommands();
    act(() => useWorkspaceStore.setState({ activeWorkspaceId: "ws-2" }));

    // When
    runCommand("git:push");

    // Then
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/workspaces/ws-2/git",
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });

  it("offers no git commands without an active workspace", () => {
    // Given
    useWorkspaceStore.setState({ activeWorkspaceId: null });

    // When
    renderGitCommands();

    // Then
    expect(registeredCommands).toEqual([]);
  });
});
