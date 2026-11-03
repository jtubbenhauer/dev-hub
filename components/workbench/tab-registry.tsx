import type { FunctionComponent } from "react";
import type { IDockviewPanelProps } from "dockview-react";
import { ChatTabPanel } from "@/components/workbench/tabs/chat-tab-panel";
import { DiffTabPanel } from "@/components/workbench/tabs/diff-tab-panel";
import { FileTabPanel } from "@/components/workbench/tabs/file-tab-panel";
import { TerminalTabPanel } from "@/components/workbench/tabs/terminal-tab-panel";
import { LauncherPanel } from "@/components/workbench/workbench-launcher";
import type {
  WorkbenchTabKind,
  WorkbenchTabParams,
} from "@/lib/workbench/tab-descriptors";

// dockview `component` names are the tab kinds (see createDockviewLayoutApi).
export const WORKBENCH_PANEL_COMPONENTS: Record<
  WorkbenchTabKind,
  FunctionComponent<IDockviewPanelProps<WorkbenchTabParams>>
> = {
  terminal: TerminalTabPanel,
  file: FileTabPanel,
  chat: ChatTabPanel,
  diff: DiffTabPanel,
  launcher: LauncherPanel,
};
