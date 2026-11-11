"use client";

import { useEffect, useMemo } from "react";
import { Play } from "lucide-react";
import {
  useCommandPalette,
  type PaletteCommand,
} from "@/components/providers/command-palette-provider";
import { useCommandStore } from "@/stores/command-store";
import { useWorkspaceStore } from "@/stores/workspace-store";

// The active workspace's quick commands, run in the command runner drawer
// the same way the workspace card's buttons run them.
export function WorkspaceQuickCommands() {
  const workspaces = useWorkspaceStore((state) => state.workspaces);
  const activeWorkspaceId = useWorkspaceStore(
    (state) => state.activeWorkspaceId,
  );
  const { registerCommands } = useCommandPalette();

  const commands = useMemo<PaletteCommand[]>(() => {
    const workspace = workspaces.find(
      (candidate) => candidate.id === activeWorkspaceId,
    );
    if (!workspace) return [];
    return (workspace.quickCommands ?? []).map((quickCommand) => ({
      id: `quick-command:${workspace.id}:${quickCommand.command}`,
      label: quickCommand.label,
      group: "Run",
      icon: Play,
      detail: quickCommand.command,
      keywords: [quickCommand.command],
      onSelect: () => {
        const { runCommand, setDrawerOpen } = useCommandStore.getState();
        runCommand(quickCommand.command, workspace.id);
        setDrawerOpen(true);
      },
    }));
  }, [workspaces, activeWorkspaceId]);

  useEffect(() => registerCommands(commands), [registerCommands, commands]);

  return null;
}
