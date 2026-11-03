import { loadFileIntoEditorBuffer } from "@/lib/files/load-file-into-editor-buffer";
import type { DiffSource } from "@/lib/workbench/tab-descriptors";
import {
  getWorkbenchController,
  type FocusableWorkbenchTabKind,
  type WorkbenchController,
} from "@/lib/workbench/workbench-controller-registry";
import {
  createWorkbenchHref,
  WORKBENCH_PATH,
} from "@/lib/workbench/workbench-href";
import { useChatStore } from "@/stores/chat-store";
import { useEditorStore } from "@/stores/editor-store";
import { useWorkbenchStore } from "@/stores/workbench-store";
import { useWorkspaceStore } from "@/stores/workspace-store";

export type WorkbenchNavigate = (href: string) => void;

export interface OpenFileInWorkbenchInput {
  readonly workspaceId: string;
  readonly path: string;
  readonly isFileTabsDisabled: boolean;
  readonly shouldCommit?: () => boolean;
  readonly navigate: WorkbenchNavigate;
}

export interface OpenChatInWorkbenchInput {
  readonly workspaceId: string;
  readonly sessionId: string | null;
  readonly navigate: WorkbenchNavigate;
}

export interface OpenWorkspaceTabInWorkbenchInput {
  readonly workspaceId: string | null;
  readonly navigate: WorkbenchNavigate;
}

export interface OpenDiffInWorkbenchInput {
  readonly workspaceId: string;
  readonly path: string;
  readonly source: DiffSource;
  readonly baseRef: string | null;
}

export interface FocusRecentInWorkbenchInput {
  readonly kind: FocusableWorkbenchTabKind;
  readonly navigate: WorkbenchNavigate;
}

function getDirectController(
  workspaceId: string | null,
): WorkbenchController | null {
  const controller = getWorkbenchController();
  if (!controller || workspaceId === null) return null;
  return controller.workspaceId === workspaceId ? controller : null;
}

function clearPendingRevealForPath(path: string): void {
  const { pendingReveal, clearReveal } = useEditorStore.getState();
  if (pendingReveal?.path === path) clearReveal(pendingReveal.id);
}

export async function openFileInWorkbench(
  input: OpenFileInWorkbenchInput,
): Promise<boolean> {
  const { workspaceId, path, isFileTabsDisabled, shouldCommit, navigate } =
    input;
  const controller = getDirectController(workspaceId);
  if (!controller) {
    navigate(createWorkbenchHref({ open: "file", workspaceId, path }));
    return true;
  }
  const isLoaded = await loadFileIntoEditorBuffer({
    workspaceId,
    path,
    isFileTabsDisabled,
    shouldCommit,
  });
  if (!isLoaded) {
    clearPendingRevealForPath(path);
    return false;
  }
  if (shouldCommit && !shouldCommit()) return false;
  if (isFileTabsDisabled) {
    controller.closeTabs(
      (params) => params.kind === "file" && params.path !== path,
    );
  }
  controller.openTab({ kind: "file", workspaceId, path });
  return true;
}

export function openChatInWorkbench(input: OpenChatInWorkbenchInput): void {
  const { workspaceId, sessionId, navigate } = input;
  const controller = getDirectController(workspaceId);
  if (sessionId === null) {
    if (controller) {
      if (!controller.focusMostRecent("chat")) controller.openNewChat();
      return;
    }
    navigate(createWorkbenchHref({ open: "chat", workspaceId, sessionId }));
    return;
  }
  useWorkspaceStore.getState().setActiveWorkspaceId(workspaceId);
  useChatStore.getState().setActiveWorkspaceSession(workspaceId, sessionId);
  if (controller) {
    useWorkbenchStore
      .getState()
      .requestChatTarget({ workspaceId, sessionId, panelId: null });
    return;
  }
  navigate(createWorkbenchHref({ open: "chat", workspaceId, sessionId }));
}

export function openNewChatInWorkbench(
  input: OpenWorkspaceTabInWorkbenchInput,
): void {
  const { workspaceId, navigate } = input;
  const controller = getDirectController(workspaceId);
  if (controller) {
    controller.openNewChat();
    return;
  }
  navigate(createWorkbenchHref({ open: "new-chat", workspaceId }));
}

export function openTerminalInWorkbench(
  input: OpenWorkspaceTabInWorkbenchInput,
): void {
  const { workspaceId, navigate } = input;
  const controller = getDirectController(workspaceId);
  if (controller) {
    controller.openNewTerminal();
    return;
  }
  navigate(createWorkbenchHref({ open: "terminal", workspaceId }));
}

export function openDiffInWorkbench(input: OpenDiffInWorkbenchInput): boolean {
  const { workspaceId, path, source, baseRef } = input;
  const controller = getDirectController(workspaceId);
  if (!controller) return false;
  controller.openTab({ kind: "diff", workspaceId, path, source, baseRef });
  return true;
}

function openFallbackForKind(
  controller: WorkbenchController,
  kind: FocusableWorkbenchTabKind,
): void {
  switch (kind) {
    case "chat":
      controller.openNewChat();
      return;
    case "terminal":
      controller.openNewTerminal();
      return;
    case "file":
      controller.openContextSidebar("explorer");
      return;
    default: {
      const unhandledKind: never = kind;
      throw new Error(`Unhandled workbench tab kind: ${String(unhandledKind)}`);
    }
  }
}

function createRecentIntentHref(kind: FocusableWorkbenchTabKind): string {
  switch (kind) {
    case "chat":
      return createWorkbenchHref({
        open: "chat",
        workspaceId: null,
        sessionId: null,
      });
    case "terminal":
      return createWorkbenchHref({ open: "terminal", workspaceId: null });
    case "file":
      return createWorkbenchHref({ open: "explorer", workspaceId: null });
    default: {
      const unhandledKind: never = kind;
      throw new Error(`Unhandled workbench tab kind: ${String(unhandledKind)}`);
    }
  }
}

export function focusRecentInWorkbench(
  input: FocusRecentInWorkbenchInput,
): void {
  const { kind, navigate } = input;
  const controller = getWorkbenchController();
  if (!controller) {
    navigate(createRecentIntentHref(kind));
    return;
  }
  if (!controller.focusMostRecent(kind)) openFallbackForKind(controller, kind);
}

export function isWorkbenchPathname(pathname: string): boolean {
  return pathname === WORKBENCH_PATH;
}
