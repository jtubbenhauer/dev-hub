import { toggleWorkbenchContextSidebar } from "@/components/workbench/toggle-workbench-context-sidebar";
import { useLeaderAction } from "@/hooks/use-leader-action";
import {
  getWorkbenchController,
  type WorkbenchCommand,
} from "@/lib/workbench/workbench-controller-registry";
import type { WorkbenchTabNumber } from "@/lib/workbench/workbench-shortcuts";

type WorkbenchLeaderRegistration = Parameters<
  typeof useLeaderAction
>[0][number];

const WORKBENCH_TAB_NUMBERS: readonly WorkbenchTabNumber[] = [
  1, 2, 3, 4, 5, 6, 7, 8, 9,
];

function runWorkbenchCommand(command: WorkbenchCommand): void {
  getWorkbenchController()?.runCommand(command);
}

function commandRegistration(
  id: string,
  label: string,
  command: WorkbenchCommand,
): WorkbenchLeaderRegistration {
  return {
    action: { id, label, page: "workbench" },
    handler: () => runWorkbenchCommand(command),
  };
}

// Module-level so useLeaderAction gets the stable array it requires. The keys
// and the which-key labels come from lib/leader-key-defaults.
const WORKBENCH_LEADER_ACTIONS: WorkbenchLeaderRegistration[] = [
  {
    action: {
      id: "workbench:next-tab",
      label: "Next tab",
      page: "workbench",
      isRepeatable: true,
    },
    handler: () => runWorkbenchCommand({ type: "cycle", direction: "next" }),
  },
  {
    action: {
      id: "workbench:prev-tab",
      label: "Previous tab",
      page: "workbench",
      isRepeatable: true,
    },
    handler: () =>
      runWorkbenchCommand({ type: "cycle", direction: "previous" }),
  },
  ...WORKBENCH_TAB_NUMBERS.map((tabNumber) =>
    commandRegistration(
      `workbench:focus-tab-${tabNumber}`,
      tabNumber === 9 ? "Go to last tab" : `Go to tab ${tabNumber}`,
      { type: "focus-number", n: tabNumber },
    ),
  ),
  commandRegistration("workbench:close-tab", "Close tab", {
    type: "close-active",
  }),
  commandRegistration("workbench:split-right", "Split right", {
    type: "split",
    direction: "right",
  }),
  commandRegistration("workbench:split-down", "Split down", {
    type: "split",
    direction: "below",
  }),
  commandRegistration("workbench:move-tab-right", "Move tab right", {
    type: "move-tab",
    direction: "right",
  }),
  commandRegistration("workbench:move-tab-left", "Move tab left", {
    type: "move-tab",
    direction: "left",
  }),
  commandRegistration("workbench:focus-group-left", "Focus group left", {
    type: "focus-group",
    direction: "left",
  }),
  commandRegistration("workbench:focus-group-right", "Focus group right", {
    type: "focus-group",
    direction: "right",
  }),
  commandRegistration("workbench:focus-group-up", "Focus group above", {
    type: "focus-group",
    direction: "up",
  }),
  commandRegistration("workbench:focus-group-down", "Focus group below", {
    type: "focus-group",
    direction: "down",
  }),
  {
    action: {
      id: "workbench:new-terminal",
      label: "New terminal",
      page: "workbench",
    },
    handler: () => getWorkbenchController()?.openNewTerminal(),
  },
  {
    action: { id: "workbench:new-chat", label: "New chat", page: "workbench" },
    handler: () => getWorkbenchController()?.openNewChat(),
  },
  {
    action: {
      id: "workbench:toggle-context-sidebar",
      label: "Toggle context sidebar",
      page: "workbench",
    },
    handler: toggleWorkbenchContextSidebar,
  },
];

// WorkbenchView mounts this, so workbench:* keys exist only on the workbench route.
export function useWorkbenchLeaderActions(): void {
  useLeaderAction(WORKBENCH_LEADER_ACTIONS);
}
