import type { WorkbenchTabParams } from "@/lib/workbench/tab-descriptors";
import type {
  WorkbenchGroupDirection,
  WorkbenchTabNumber,
} from "@/lib/workbench/workbench-shortcuts";
import type { ContextSidebarView } from "@/stores/context-sidebar-store";

export type FocusableWorkbenchTabKind = "chat" | "file" | "terminal";

// Which group a new tab lands in; null (or no target) means the active group.
export interface WorkbenchTabTarget {
  readonly groupId: string | null;
}

// Keyboard-driven layout commands, shared by the chords and the leader keys.
export type WorkbenchCommand =
  | { readonly type: "cycle"; readonly direction: "next" | "previous" }
  | { readonly type: "focus-number"; readonly n: WorkbenchTabNumber }
  | {
      readonly type: "focus-group";
      readonly direction: WorkbenchGroupDirection;
    }
  | { readonly type: "split"; readonly direction: "right" | "below" }
  | { readonly type: "move-tab"; readonly direction: "left" | "right" }
  | { readonly type: "close-active" };

export interface WorkbenchController {
  readonly workspaceId: string;
  openTab(params: WorkbenchTabParams): string;
  openNewTerminal(target?: WorkbenchTabTarget): string;
  openNewChat(target?: WorkbenchTabTarget): string;
  closeTabs(predicate: (params: WorkbenchTabParams) => boolean): void;
  focusMostRecent(kind: FocusableWorkbenchTabKind): boolean;
  openContextSidebar(view: ContextSidebarView): void;
  revealFolder(path: string): void;
  runCommand(command: WorkbenchCommand): void;
}

let registeredController: WorkbenchController | null = null;

export function registerWorkbenchController(
  controller: WorkbenchController,
): () => void {
  registeredController = controller;
  return () => {
    if (registeredController === controller) registeredController = null;
  };
}

export function getWorkbenchController(): WorkbenchController | null {
  return registeredController;
}
