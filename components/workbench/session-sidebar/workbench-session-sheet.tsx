"use client";

import { useCallback } from "react";
import { SessionList } from "@/components/chat/session-list";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useWorkbenchSessionList } from "@/components/workbench/session-sidebar/use-workbench-session-list";
import { useSessionSidebarStore } from "@/stores/session-sidebar-store";

interface WorkbenchSessionSheetProps {
  readonly workspaceId: string;
}

function closeSheet(): void {
  useSessionSidebarStore.getState().setMobileSheetOpen(false);
}

export function WorkbenchSessionSheet({
  workspaceId,
}: WorkbenchSessionSheetProps) {
  const isMobileSheetOpen = useSessionSidebarStore(
    (state) => state.isMobileSheetOpen,
  );
  // A pick or create closes the sheet so the chosen chat becomes visible.
  const { isUnifiedMode, unifiedProps, workspaceProps } =
    useWorkbenchSessionList(workspaceId, { onPick: closeSheet });

  const handleOpenChange = useCallback((isOpen: boolean) => {
    useSessionSidebarStore.getState().setMobileSheetOpen(isOpen);
  }, []);

  return (
    <Sheet open={isMobileSheetOpen} onOpenChange={handleOpenChange}>
      <SheetContent side="left" className="w-72 p-0" showCloseButton={false}>
        <SheetHeader className="sr-only">
          <SheetTitle>Sessions</SheetTitle>
        </SheetHeader>
        {isUnifiedMode ? (
          <SessionList {...unifiedProps} />
        ) : (
          <SessionList {...workspaceProps} />
        )}
      </SheetContent>
    </Sheet>
  );
}
