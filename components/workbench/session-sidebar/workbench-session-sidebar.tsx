"use client";

import { GripVertical } from "lucide-react";
import { SessionList } from "@/components/chat/session-list";
import { useWorkbenchSessionList } from "@/components/workbench/session-sidebar/use-workbench-session-list";
import { useResizablePanel } from "@/hooks/use-resizable-panel";
import { useSessionSidebarStore } from "@/stores/session-sidebar-store";

interface WorkbenchSessionSidebarProps {
  readonly workspaceId: string;
}

function OpenSessionSidebar({ workspaceId }: WorkbenchSessionSidebarProps) {
  const { isUnifiedMode, unifiedProps, workspaceProps } =
    useWorkbenchSessionList(workspaceId);
  // Same storage key as the old in-tab panel, so the user's width carries over.
  const { width, handleDragStart } = useResizablePanel({
    minWidth: 160,
    maxWidth: 400,
    defaultWidth: 240,
    storageKey: "dev-hub:chat-panel-width",
  });

  return (
    <aside
      aria-label="Session sidebar"
      className="flex h-full min-h-0 shrink-0"
    >
      <div
        data-testid="session-sidebar-content"
        className="relative shrink-0 overflow-hidden"
        style={{ width }}
      >
        {isUnifiedMode ? (
          <SessionList {...unifiedProps} />
        ) : (
          <SessionList {...workspaceProps} />
        )}
      </div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize session sidebar"
        className="hover:bg-accent/50 active:bg-accent flex w-1.5 shrink-0 cursor-col-resize items-center justify-center transition-colors"
        onMouseDown={handleDragStart}
      >
        <GripVertical className="text-muted-foreground/30 size-3.5" />
      </div>
    </aside>
  );
}

export function WorkbenchSessionSidebar({
  workspaceId,
}: WorkbenchSessionSidebarProps) {
  const isOpen = useSessionSidebarStore((state) => state.isOpen);
  if (!isOpen) return null;
  return <OpenSessionSidebar workspaceId={workspaceId} />;
}
