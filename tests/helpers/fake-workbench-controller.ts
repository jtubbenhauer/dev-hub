import { vi } from "vitest";
import type { WorkbenchTabParams } from "@/lib/workbench/tab-descriptors";
import {
  registerWorkbenchController,
  type FocusableWorkbenchTabKind,
  type WorkbenchController,
} from "@/lib/workbench/workbench-controller-registry";
import type { ContextSidebarView } from "@/stores/context-sidebar-store";

export function createFakeWorkbenchController(workspaceId: string) {
  return {
    workspaceId,
    openTab: vi.fn<(params: WorkbenchTabParams) => string>(() => "tab-opened"),
    openNewTerminal: vi.fn<() => string>(() => "tab-terminal"),
    openNewChat: vi.fn<() => string>(() => "tab-chat"),
    closeTabs:
      vi.fn<(predicate: (params: WorkbenchTabParams) => boolean) => void>(),
    focusMostRecent: vi.fn<(kind: FocusableWorkbenchTabKind) => boolean>(
      () => false,
    ),
    openContextSidebar: vi.fn<(view: ContextSidebarView) => void>(),
    revealFolder: vi.fn<(path: string) => void>(),
  } satisfies WorkbenchController;
}

export type FakeWorkbenchController = ReturnType<
  typeof createFakeWorkbenchController
>;

// Stands in for a mounted workbench showing `workspaceId`; call `unmount` in
// afterEach so the single registry slot never leaks into the next test.
export function mountFakeWorkbench(workspaceId: string): {
  readonly controller: FakeWorkbenchController;
  readonly unmount: () => void;
} {
  const controller = createFakeWorkbenchController(workspaceId);
  return { controller, unmount: registerWorkbenchController(controller) };
}
