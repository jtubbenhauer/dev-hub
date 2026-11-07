import type { IDockviewPanel } from "dockview-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TAB_KIND_ICONS } from "@/components/workbench/workbench-tab-header";
import { isWorkbenchTabParams } from "@/lib/workbench/tab-descriptors";

type SwitcherPanel = Pick<IDockviewPanel, "id" | "title" | "params">;

interface WorkbenchTabSwitcherProps {
  readonly panels: readonly SwitcherPanel[];
  readonly activePanelId: string | null;
  readonly onSelectPanel: (panelId: string) => void;
}

// A phone shows only a slice of the tab strip, so this lists every tab, and its
// count changes only when a tab opens or closes.
export function WorkbenchTabSwitcher({
  panels,
  activePanelId,
  onSelectPanel,
}: WorkbenchTabSwitcherProps) {
  if (panels.length < 2) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={`Switch tab, ${panels.length} open`}
        >
          <span className="flex size-4 items-center justify-center rounded-[4px] border-[1.5px] border-current text-[9px] leading-none font-semibold tabular-nums">
            {panels.length}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="max-w-(--radix-dropdown-menu-content-available-width)"
      >
        <DropdownMenuLabel className="text-muted-foreground text-xs">
          Open tabs
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={activePanelId ?? ""}
          onValueChange={onSelectPanel}
        >
          {panels.map((panel) => {
            const TabIcon = isWorkbenchTabParams(panel.params)
              ? TAB_KIND_ICONS[panel.params.kind]
              : null;
            return (
              <DropdownMenuRadioItem key={panel.id} value={panel.id}>
                {TabIcon && <TabIcon aria-hidden />}
                <span className="min-w-0 truncate">
                  {panel.title ?? panel.id}
                </span>
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
