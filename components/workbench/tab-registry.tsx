import type { FunctionComponent } from "react";
import type { IDockviewPanelProps } from "dockview-react";
import { TerminalTabPanel } from "@/components/workbench/tabs/terminal-tab-panel";
import { DiffTabPanel } from "@/components/workbench/tabs/diff-tab-panel";
import { LauncherPanel } from "@/components/workbench/workbench-launcher";
import { WorkbenchPanelFrame } from "@/components/workbench/workbench-panel-frame";
import type {
  WorkbenchTabKind,
  WorkbenchTabParams,
} from "@/lib/workbench/tab-descriptors";

// Body for a tab kind that does not have its real panel yet; shows the kind name.
export function WorkbenchPlaceholderPanel({
  api,
  params,
}: IDockviewPanelProps<WorkbenchTabParams>) {
  return (
    <WorkbenchPanelFrame api={api}>
      <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
        {params.kind}
      </div>
    </WorkbenchPanelFrame>
  );
}

// dockview `component` names are the tab kinds (see createDockviewLayoutApi).
export const WORKBENCH_PANEL_COMPONENTS: Record<
  WorkbenchTabKind,
  FunctionComponent<IDockviewPanelProps<WorkbenchTabParams>>
> = {
  terminal: TerminalTabPanel,
  file: WorkbenchPlaceholderPanel,
  chat: WorkbenchPlaceholderPanel,
  diff: DiffTabPanel,
  launcher: LauncherPanel,
};
