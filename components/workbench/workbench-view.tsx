"use client";

import { useEffect } from "react";
import { FolderOpen } from "lucide-react";
import { WorkspaceChatEffectsHost } from "@/components/chat/workspace-chat-effects-host";
import { ContextSidebarSlot } from "@/components/workbench/context-sidebar-slot";
import { useWorkbenchIntent } from "@/components/workbench/use-workbench-intent";
import { WorkbenchDockview } from "@/components/workbench/workbench-dockview";
import { useIsMobileResolved } from "@/hooks/use-is-mobile-resolved";
import { useEditorStore } from "@/stores/editor-store";
import { useWorkbenchStore } from "@/stores/workbench-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { Workspace } from "@/types";

// The store's `activeWorkspace` getter goes stale after a set(), so derive it.
function selectActiveWorkspace(state: {
  readonly workspaces: readonly Workspace[];
  readonly activeWorkspaceId: string | null;
}): Workspace | null {
  return (
    state.workspaces.find(
      (workspace) => workspace.id === state.activeWorkspaceId,
    ) ?? null
  );
}

// A chat the workspace effects start (e.g. a worktree's plan) opens in a tab.
function requestStartedChatTarget(workspaceId: string, sessionId: string) {
  useWorkbenchStore
    .getState()
    .requestChatTarget({ workspaceId, sessionId, panelId: null });
}

export function WorkbenchView() {
  const activeWorkspaceId = useWorkspaceStore(
    (state) => state.activeWorkspaceId,
  );
  const workspaces = useWorkspaceStore((state) => state.workspaces);
  const activeWorkspace = useWorkspaceStore(selectActiveWorkspace);
  const isMobile = useIsMobileResolved();
  const layoutWorkspaceId = activeWorkspace?.id ?? null;

  useEffect(() => {
    if (layoutWorkspaceId === null) return;
    useEditorStore.getState().releaseOtherWorkspaceTabs(layoutWorkspaceId);
  }, [layoutWorkspaceId]);

  useEffect(() => {
    if (workspaces.length === 0) return;
    useWorkbenchStore
      .getState()
      .pruneWorkspaces(workspaces.map((workspace) => workspace.id));
  }, [workspaces]);

  useWorkbenchIntent({ activeWorkspaceId, workspaces });

  // Waiting for the breakpoint keeps a phone from mounting (and later saving) a
  // desktop layout first.
  if (isMobile === null) return null;

  if (layoutWorkspaceId === null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
        <FolderOpen className="text-muted-foreground/40 h-10 w-10" />
        <p className="text-muted-foreground text-sm">
          Select a workspace to start
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0">
      <WorkspaceChatEffectsHost onSessionStarted={requestStartedChatTarget} />
      <div className="min-w-0 flex-1">
        <WorkbenchDockview
          key={`${layoutWorkspaceId}:${isMobile}`}
          workspaceId={layoutWorkspaceId}
          isMobile={isMobile}
        />
      </div>
      <ContextSidebarSlot />
    </div>
  );
}
