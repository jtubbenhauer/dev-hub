import {
  requestCloseTab,
  type EndTerminalSession,
} from "@/components/workbench/workbench-close-tab";
import {
  createChatSessionTitleLookups,
  NEW_CHAT_TAB_TITLE,
  workbenchTabTitle,
} from "@/components/workbench/workbench-tab-title";
import {
  createWorkbenchTerminalSessionId,
  nextTerminalTitle,
  type WorkbenchTabParams,
} from "@/lib/workbench/tab-descriptors";
import {
  cycleTab,
  focusAdjacentGroup,
  focusTabNumber,
  moveActivePanelToAdjacentGroup,
  openOrFocusTab,
  splitActiveGroup,
} from "@/lib/workbench/workbench-commands";
import type {
  FocusableWorkbenchTabKind,
  WorkbenchCommand,
  WorkbenchController,
  WorkbenchTabTarget,
} from "@/lib/workbench/workbench-controller-registry";
import type { WorkbenchLayoutApi } from "@/lib/workbench/workbench-layout-api";
import { useChatStore } from "@/stores/chat-store";
import { useContextSidebarStore } from "@/stores/context-sidebar-store";
import { useEditorStore } from "@/stores/editor-store";
import { useWorkbenchStore } from "@/stores/workbench-store";

export interface WorkbenchDockviewControllerInput {
  readonly layoutApi: WorkbenchLayoutApi;
  readonly workspaceId: string;
  readonly endTerminalSession: EndTerminalSession;
  readonly isMobile: boolean;
}

function currentTabTitle(params: WorkbenchTabParams): string {
  const { workspaceStates } = useChatStore.getState();
  return workbenchTabTitle(
    params,
    createChatSessionTitleLookups(workspaceStates),
  );
}

function openTerminalTitles(layoutApi: WorkbenchLayoutApi): string[] {
  return layoutApi
    .getPanels()
    .flatMap((panel) =>
      panel.params.kind === "terminal" ? [panel.params.title] : [],
    );
}

// Prefers the last-focused tab of the kind, then any open tab of that kind.
function focusMostRecentTab(
  layoutApi: WorkbenchLayoutApi,
  workspaceId: string,
  kind: FocusableWorkbenchTabKind,
): boolean {
  const panels = layoutApi.getPanels();
  const lastFocusedPanelId =
    useWorkbenchStore.getState().lastFocusedPanelByWorkspace[workspaceId]?.[
      kind
    ]?.panelId;
  const targetPanel =
    panels.find((panel) => panel.id === lastFocusedPanelId) ??
    panels.find((panel) => panel.params.kind === kind);
  if (!targetPanel) return false;
  layoutApi.activatePanel(targetPanel.id);
  return true;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled workbench command: ${JSON.stringify(value)}`);
}

// A phone shows a single group, so splits and tab moves are ignored there.
function runWorkbenchCommand(
  input: WorkbenchDockviewControllerInput,
  command: WorkbenchCommand,
): void {
  const { layoutApi, endTerminalSession, isMobile } = input;
  switch (command.type) {
    case "cycle":
      cycleTab(layoutApi, command.direction);
      return;
    case "focus-number":
      focusTabNumber(layoutApi, command.n);
      return;
    case "focus-group":
      focusAdjacentGroup(layoutApi, command.direction);
      return;
    case "split":
      if (!isMobile) splitActiveGroup(layoutApi, command.direction);
      return;
    case "move-tab":
      if (!isMobile) {
        moveActivePanelToAdjacentGroup(layoutApi, command.direction);
      }
      return;
    case "close-active": {
      const activePanelId = layoutApi.getActivePanelId();
      if (activePanelId === null) return;
      requestCloseTab({
        layoutApi,
        panelId: activePanelId,
        endTerminalSession,
      });
      return;
    }
    default:
      assertNever(command);
  }
}

export function createWorkbenchDockviewController(
  input: WorkbenchDockviewControllerInput,
): WorkbenchController {
  const { layoutApi, workspaceId, endTerminalSession } = input;

  const openInTarget = (
    params: WorkbenchTabParams,
    title: string,
    target: WorkbenchTabTarget | undefined,
  ) =>
    openOrFocusTab(layoutApi, params, title, {
      groupId: target?.groupId ?? null,
    });

  return {
    workspaceId,
    openTab: (params) =>
      openOrFocusTab(layoutApi, params, currentTabTitle(params)),
    openNewTerminal: (target) => {
      const title = nextTerminalTitle(openTerminalTitles(layoutApi));
      const sessionId = createWorkbenchTerminalSessionId();
      return openInTarget(
        { kind: "terminal", workspaceId, sessionId, title },
        title,
        target,
      );
    },
    openNewChat: (target) =>
      openInTarget(
        { kind: "chat", workspaceId, sessionId: null },
        NEW_CHAT_TAB_TITLE,
        target,
      ),
    closeTabs: (predicate) => {
      for (const panel of layoutApi.getPanels()) {
        if (!predicate(panel.params)) continue;
        requestCloseTab({ layoutApi, panelId: panel.id, endTerminalSession });
      }
    },
    focusMostRecent: (kind) => focusMostRecentTab(layoutApi, workspaceId, kind),
    openContextSidebar: (view) =>
      useContextSidebarStore.getState().openView(view),
    revealFolder: (path) => {
      useEditorStore.getState().expandFolder(workspaceId, path);
      useContextSidebarStore.getState().openView("explorer");
    },
    runCommand: (command) => runWorkbenchCommand(input, command),
  };
}
