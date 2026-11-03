import { useEffect } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ContextSidebarContent } from "@/components/workbench/context-sidebar/context-sidebar-content";
import { CONTEXT_SIDEBAR_VIEW_ITEMS } from "@/components/workbench/context-sidebar/context-sidebar-views";
import { cn } from "@/lib/utils";
import { useContextSidebarStore } from "@/stores/context-sidebar-store";
import { useWorkbenchStore } from "@/stores/workbench-store";
import type { Workspace } from "@/types";

interface ContextSidebarMobileSheetProps {
  readonly workspaceId: string;
  readonly workspace: Workspace;
  readonly changedPathCount: number;
}

export function ContextSidebarMobileSheet({
  workspaceId,
  workspace,
  changedPathCount,
}: ContextSidebarMobileSheetProps) {
  const isMobileSheetOpen = useContextSidebarStore(
    (state) => state.isMobileSheetOpen,
  );
  const setMobileSheetOpen = useContextSidebarStore(
    (state) => state.setMobileSheetOpen,
  );
  const shownView = useContextSidebarStore((state) => state.view);

  // A tab opened or focused from the sheet sits under it, so get out of the way.
  useEffect(
    () =>
      useWorkbenchStore.subscribe((state, previousState) => {
        const panelId = state.focusedPanel?.panelId;
        if (panelId === previousState.focusedPanel?.panelId) return;
        const contextSidebar = useContextSidebarStore.getState();
        if (contextSidebar.isMobileSheetOpen) {
          contextSidebar.setMobileSheetOpen(false);
        }
      }),
    [],
  );

  return (
    <Sheet open={isMobileSheetOpen} onOpenChange={setMobileSheetOpen}>
      <SheetContent
        side="right"
        className="w-80 gap-0 p-0"
        showCloseButton={false}
        aria-describedby={undefined}
      >
        <SheetHeader className="sr-only">
          <SheetTitle>Panels</SheetTitle>
        </SheetHeader>
        <div className="flex h-10 shrink-0 items-center gap-1 border-b px-2">
          <div
            role="group"
            aria-label="Context sidebar views"
            className="flex items-center gap-1"
          >
            {CONTEXT_SIDEBAR_VIEW_ITEMS.map(({ view, label }) => {
              const isShown = view === shownView;
              const badgeCount = view === "changes" ? changedPathCount : 0;
              return (
                <button
                  key={view}
                  type="button"
                  aria-label={label}
                  aria-pressed={isShown}
                  className={cn(
                    "focus-visible:ring-ring/50 inline-flex h-8 items-center gap-1 rounded-sm border-b-2 px-1.5 text-xs transition-colors outline-none focus-visible:ring-[3px]",
                    isShown
                      ? "text-foreground border-primary font-medium"
                      : "text-muted-foreground hover:text-foreground/70 border-transparent",
                  )}
                  onClick={() =>
                    useContextSidebarStore.getState().setView(view)
                  }
                >
                  {label}
                  {badgeCount > 0 && (
                    <span className="bg-muted text-muted-foreground rounded-full px-1.5 text-[10px] tabular-nums">
                      {badgeCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <SheetClose asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="Close panels"
              className="ml-auto"
            >
              <X />
            </Button>
          </SheetClose>
        </div>
        <ContextSidebarContent
          view={shownView}
          workspaceId={workspaceId}
          workspace={workspace}
        />
      </SheetContent>
    </Sheet>
  );
}
