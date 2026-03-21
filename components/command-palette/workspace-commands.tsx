"use client";

import { useEffect, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { FolderGit2 } from "lucide-react";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useChatStore } from "@/stores/chat-store";
import type { WorkspaceActivity } from "@/stores/chat-store";
import { useCommandPalette } from "@/components/providers/command-palette-provider";
import type { PaletteCommand } from "@/components/providers/command-palette-provider";
import { cn } from "@/lib/utils";

function useAllWorkspaceActivities(
  workspaceIds: string[],
): Record<string, WorkspaceActivity> {
  return useChatStore(
    useShallow((state) => {
      const result: Record<string, WorkspaceActivity> = {};
      for (const wsId of workspaceIds) {
        const ws = state.workspaceStates[wsId];
        if (!ws) {
          result[wsId] = "idle";
          continue;
        }
        if (ws.permissions.length > 0 || ws.questions.length > 0) {
          result[wsId] = "waiting";
          continue;
        }
        const hasActiveSession = Object.values(ws.sessionStatuses).some(
          (s) => s.type !== "idle",
        );
        result[wsId] = hasActiveSession ? "active" : "idle";
      }
      return result;
    }),
  );
}

function WorkspaceIcon({ activity }: { activity: WorkspaceActivity }) {
  return (
    <span className="relative flex items-center">
      <FolderGit2 />
      <span
        className={cn(
          "absolute -top-0.5 -right-0.5 size-1.5 rounded-full",
          activity === "active" && "animate-pulse bg-emerald-500",
          activity === "waiting" && "bg-amber-500",
          activity === "idle" && "invisible",
        )}
      />
    </span>
  );
}

export function WorkspaceCommands() {
  const { workspaces, activeWorkspaceId, setActiveWorkspaceId } =
    useWorkspaceStore();

  const workspaceIds = useMemo(() => workspaces.map((w) => w.id), [workspaces]);
  const activities = useAllWorkspaceActivities(workspaceIds);

  const commands = useMemo<PaletteCommand[]>(
    () =>
      workspaces
        .filter((w) => w.id !== activeWorkspaceId)
        .map((w) => {
          const activity = activities[w.id] ?? "idle";
          return {
            id: `workspace:switch:${w.id}`,
            label: `Switch to ${w.name}`,
            group: "Workspaces",
            icon: () => <WorkspaceIcon activity={activity} />,
            onSelect: () => setActiveWorkspaceId(w.id),
          };
        }),
    [workspaces, activeWorkspaceId, activities, setActiveWorkspaceId],
  );

  const { registerCommands } = useCommandPalette();

  useEffect(() => {
    return registerCommands(commands);
  }, [registerCommands, commands]);

  return null;
}
