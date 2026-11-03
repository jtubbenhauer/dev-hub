import { afterEach, describe, expect, it } from "vitest";
import {
  getWorkbenchController,
  registerWorkbenchController,
  type WorkbenchController,
} from "@/lib/workbench/workbench-controller-registry";

function createController(workspaceId: string): WorkbenchController {
  return {
    workspaceId,
    openTab: () => "tab-1",
    openNewTerminal: () => "tab-2",
    openNewChat: () => "tab-3",
    closeTabs: () => {},
    focusMostRecent: () => false,
    openContextSidebar: () => {},
    revealFolder: () => {},
    runCommand: () => {},
  };
}

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

describe("workbench controller registry", () => {
  it("returns null when no controller is registered", () => {
    expect(getWorkbenchController()).toBeNull();
  });

  it("returns the registered controller", () => {
    const controller = createController("ws-1");
    cleanups.push(registerWorkbenchController(controller));

    expect(getWorkbenchController()).toBe(controller);
  });

  it("removes the controller when its own unregister runs", () => {
    const unregister = registerWorkbenchController(createController("ws-1"));

    unregister();

    expect(getWorkbenchController()).toBeNull();
  });

  it("keeps a newer controller when a stale unregister runs", () => {
    const unregisterFirst = registerWorkbenchController(
      createController("ws-1"),
    );
    const second = createController("ws-2");
    cleanups.push(registerWorkbenchController(second));

    unregisterFirst();

    expect(getWorkbenchController()).toBe(second);
  });
});
