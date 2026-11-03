"use client";

import { useWorkspaceChatEffects } from "@/components/chat/use-workspace-chat-effects";
import { useAgentHealth } from "@/hooks/use-git";
import { useWorkspaceStore } from "@/stores/workspace-store";

interface WorkspaceChatEffectsHostProps {
  readonly onSessionStarted?: (workspaceId: string, sessionId: string) => void;
}

export function WorkspaceChatEffectsHost({
  onSessionStarted,
}: WorkspaceChatEffectsHostProps) {
  const workspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const isWorkspaceRemote = useWorkspaceStore((state) =>
    state.workspaces.some(
      (workspace) =>
        workspace.id === state.activeWorkspaceId &&
        workspace.backend === "remote",
    ),
  );
  const { data: healthStatus } = useAgentHealth(workspaceId, isWorkspaceRemote);

  useWorkspaceChatEffects({
    workspaceId,
    healthStatus,
    isWorkspaceRemote,
    onSessionStarted,
  });

  return null;
}
