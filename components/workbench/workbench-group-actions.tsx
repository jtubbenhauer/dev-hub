import type { IDockviewHeaderActionsProps } from "dockview-react";
import {
  Columns2,
  FileCode2,
  MessageSquare,
  PanelRight,
  Plus,
  Rows2,
  TerminalSquare,
} from "lucide-react";
import { useFilePicker } from "@/components/file-picker/file-picker";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useActiveTabInView } from "@/components/workbench/use-active-tab-in-view";
import { createDockviewLayoutApi } from "@/components/workbench/dockview-layout-api";
import { useIsWorkbenchMobile } from "@/components/workbench/workbench-mode-context";
import { WorkbenchTabSwitcher } from "@/components/workbench/workbench-tab-switcher";
import { splitActiveGroup } from "@/lib/workbench/workbench-commands";
import { getWorkbenchController } from "@/lib/workbench/workbench-controller-registry";
import { useContextSidebarStore } from "@/stores/context-sidebar-store";

export function WorkbenchGroupActions({
  containerApi,
  group,
  panels,
  activePanel,
}: IDockviewHeaderActionsProps) {
  const isMobile = useIsWorkbenchMobile();
  const { open: openFilePicker } = useFilePicker();
  const groupId = group.id;
  useActiveTabInView(group.element, isMobile);

  // The menu belongs to its own group, which need not be the active one.
  const splitGroup = (direction: "right" | "below") => {
    const layoutApi = createDockviewLayoutApi(containerApi);
    layoutApi.activateGroup(groupId);
    splitActiveGroup(layoutApi, direction);
  };

  return (
    <div className="flex h-full items-center gap-0.5 px-1">
      {isMobile && (
        <WorkbenchTabSwitcher
          panels={panels}
          activePanelId={activePanel?.id ?? null}
          onSelectPanel={(panelId) =>
            createDockviewLayoutApi(containerApi).activatePanel(panelId)
          }
        />
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Group actions"
          >
            <Plus />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onSelect={() =>
              getWorkbenchController()?.openNewTerminal({ groupId })
            }
          >
            <TerminalSquare />
            New terminal
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => getWorkbenchController()?.openNewChat({ groupId })}
          >
            <MessageSquare />
            New chat
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => openFilePicker()}>
            <FileCode2 />
            Open file…
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {isMobile ? (
            <DropdownMenuItem
              onSelect={() =>
                useContextSidebarStore.getState().setMobileSheetOpen(true)
              }
            >
              <PanelRight />
              Panels
            </DropdownMenuItem>
          ) : (
            <>
              <DropdownMenuItem onSelect={() => splitGroup("right")}>
                <Columns2 />
                Split right
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => splitGroup("below")}>
                <Rows2 />
                Split down
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
