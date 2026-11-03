import type { WorkbenchController } from "@/lib/workbench/workbench-controller-registry";
import type { WorkbenchIntent } from "@/lib/workbench/workbench-href";
import type { SidebarView } from "@/stores/content-search-store";
import type { ContextSidebarView } from "@/stores/context-sidebar-store";
import type { PendingChatTarget } from "@/stores/workbench-store";

export interface ApplyWorkbenchIntentDeps {
  // The workspace whose layout is ready; every action targets it.
  readonly workspaceId: string;
  readonly controller: WorkbenchController;
  readonly requestChatTarget: (target: PendingChatTarget) => void;
  readonly setActiveWorkspaceSession: (
    workspaceId: string,
    sessionId: string,
  ) => void;
  readonly setContextSidebarView: (view: ContextSidebarView) => void;
  readonly expandFolder: (workspaceId: string, path: string) => void;
  readonly setContentSearchView: (view: SidebarView) => void;
  readonly openFile: (path: string) => void;
  readonly isKnownMissingSession: (
    workspaceId: string,
    sessionId: string,
  ) => boolean;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled workbench intent: ${JSON.stringify(value)}`);
}

function focusOrOpenChat(controller: WorkbenchController): void {
  if (!controller.focusMostRecent("chat")) controller.openNewChat();
}

export function applyWorkbenchIntent(
  intent: WorkbenchIntent,
  deps: ApplyWorkbenchIntentDeps,
): void {
  const { workspaceId, controller } = deps;
  switch (intent.open) {
    case "chat": {
      const { sessionId } = intent;
      // A deleted or unknown session must never bind a tab to a dead id.
      if (
        sessionId === null ||
        deps.isKnownMissingSession(workspaceId, sessionId)
      ) {
        focusOrOpenChat(controller);
        return;
      }
      deps.setActiveWorkspaceSession(workspaceId, sessionId);
      deps.requestChatTarget({ workspaceId, sessionId, panelId: null });
      return;
    }
    case "new-chat":
      controller.openNewChat();
      return;
    case "file":
      deps.openFile(intent.path);
      return;
    case "folder":
      deps.expandFolder(workspaceId, intent.path);
      deps.setContextSidebarView("explorer");
      return;
    case "explorer":
      deps.setContextSidebarView("explorer");
      return;
    case "search":
      deps.setContextSidebarView("explorer");
      deps.setContentSearchView("search");
      return;
    case "terminal":
      controller.openNewTerminal();
      return;
    default:
      assertNever(intent);
  }
}
