import { describe, expect, it, vi } from "vitest";
import {
  applyWorkbenchIntent,
  type ApplyWorkbenchIntentDeps,
} from "@/components/workbench/apply-workbench-intent";
import type { WorkbenchController } from "@/lib/workbench/workbench-controller-registry";

const READY_WORKSPACE_ID = "w1";

interface FakeDepsInput {
  readonly hasRecentChat?: boolean;
  readonly missingSessionIds?: readonly string[];
}

function createFakeController(hasRecentChat: boolean) {
  return {
    workspaceId: READY_WORKSPACE_ID,
    openTab: vi.fn((): string => "tab-opened"),
    openNewTerminal: vi.fn((): string => "tab-terminal"),
    openNewChat: vi.fn((): string => "tab-chat"),
    closeTabs: vi.fn(),
    focusMostRecent: vi.fn((): boolean => hasRecentChat),
    openContextSidebar: vi.fn(),
    revealFolder: vi.fn(),
  } satisfies WorkbenchController;
}

function createFakeDeps(input: FakeDepsInput = {}) {
  const controller = createFakeController(input.hasRecentChat ?? false);
  const missingSessionIds = new Set(input.missingSessionIds ?? []);
  const effects = {
    requestChatTarget: vi.fn(),
    setActiveWorkspaceSession: vi.fn(),
    setContextSidebarView: vi.fn(),
    expandFolder: vi.fn(),
    setContentSearchView: vi.fn(),
    openFile: vi.fn(),
  };
  const isKnownMissingSession = vi.fn(
    (_workspaceId: string, sessionId: string): boolean =>
      missingSessionIds.has(sessionId),
  );
  const deps = {
    workspaceId: READY_WORKSPACE_ID,
    controller,
    ...effects,
    isKnownMissingSession,
  } satisfies ApplyWorkbenchIntentDeps;
  return { deps, controller, effects, isKnownMissingSession };
}

// Names of the fakes that were called, in the order of their first call.
function calledNames(fakes: Record<string, unknown>): string[] {
  return Object.entries(fakes)
    .flatMap(([name, value]) =>
      vi.isMockFunction(value) && value.mock.calls.length > 0
        ? [{ name, firstCall: value.mock.invocationCallOrder[0] ?? 0 }]
        : [],
    )
    .sort((left, right) => left.firstCall - right.firstCall)
    .map(({ name }) => name);
}

describe("applyWorkbenchIntent", () => {
  describe("chat intent with a session", () => {
    it("selects the session and queues it as a chat target without touching the layout", () => {
      // Given
      const { deps, controller, effects } = createFakeDeps();

      // When
      applyWorkbenchIntent(
        { open: "chat", workspaceId: READY_WORKSPACE_ID, sessionId: "s1" },
        deps,
      );

      // Then
      expect(effects.setActiveWorkspaceSession).toHaveBeenCalledWith(
        READY_WORKSPACE_ID,
        "s1",
      );
      expect(effects.requestChatTarget).toHaveBeenCalledWith({
        workspaceId: READY_WORKSPACE_ID,
        sessionId: "s1",
        panelId: null,
      });
      expect(calledNames(effects)).toEqual([
        "setActiveWorkspaceSession",
        "requestChatTarget",
      ]);
      expect(calledNames(controller)).toEqual([]);
    });

    it("targets the ready workspace when the link names no workspace", () => {
      // Given
      const { deps, effects, isKnownMissingSession } = createFakeDeps();

      // When
      applyWorkbenchIntent(
        { open: "chat", workspaceId: null, sessionId: "s1" },
        deps,
      );

      // Then
      expect(isKnownMissingSession).toHaveBeenCalledWith(
        READY_WORKSPACE_ID,
        "s1",
      );
      expect(effects.requestChatTarget).toHaveBeenCalledWith({
        workspaceId: READY_WORKSPACE_ID,
        sessionId: "s1",
        panelId: null,
      });
    });
  });

  describe("chat intent with a known-missing session", () => {
    it("focuses the most recent chat tab instead of binding the dead session", () => {
      // Given
      const { deps, controller, effects } = createFakeDeps({
        hasRecentChat: true,
        missingSessionIds: ["s-deleted"],
      });

      // When
      applyWorkbenchIntent(
        {
          open: "chat",
          workspaceId: READY_WORKSPACE_ID,
          sessionId: "s-deleted",
        },
        deps,
      );

      // Then
      expect(controller.focusMostRecent).toHaveBeenCalledWith("chat");
      expect(calledNames(controller)).toEqual(["focusMostRecent"]);
      expect(calledNames(effects)).toEqual([]);
    });

    it("opens a new chat when no chat tab can be focused", () => {
      // Given
      const { deps, controller, effects } = createFakeDeps({
        hasRecentChat: false,
        missingSessionIds: ["s-deleted"],
      });

      // When
      applyWorkbenchIntent(
        {
          open: "chat",
          workspaceId: READY_WORKSPACE_ID,
          sessionId: "s-deleted",
        },
        deps,
      );

      // Then
      expect(calledNames(controller)).toEqual([
        "focusMostRecent",
        "openNewChat",
      ]);
      expect(calledNames(effects)).toEqual([]);
    });
  });

  describe("chat intent without a session", () => {
    it("focuses the most recent chat tab", () => {
      // Given
      const { deps, controller, effects } = createFakeDeps({
        hasRecentChat: true,
      });

      // When
      applyWorkbenchIntent(
        { open: "chat", workspaceId: null, sessionId: null },
        deps,
      );

      // Then
      expect(controller.focusMostRecent).toHaveBeenCalledWith("chat");
      expect(calledNames(controller)).toEqual(["focusMostRecent"]);
      expect(calledNames(effects)).toEqual([]);
    });

    it("opens a new chat when no chat tab can be focused", () => {
      // Given
      const { deps, controller, effects } = createFakeDeps({
        hasRecentChat: false,
      });

      // When
      applyWorkbenchIntent(
        { open: "chat", workspaceId: null, sessionId: null },
        deps,
      );

      // Then
      expect(calledNames(controller)).toEqual([
        "focusMostRecent",
        "openNewChat",
      ]);
      expect(calledNames(effects)).toEqual([]);
    });
  });

  it("opens a new chat for a new-chat intent even when a chat tab could be focused", () => {
    // Given
    const { deps, controller, effects } = createFakeDeps({
      hasRecentChat: true,
    });

    // When
    applyWorkbenchIntent({ open: "new-chat", workspaceId: null }, deps);

    // Then
    expect(calledNames(controller)).toEqual(["openNewChat"]);
    expect(calledNames(effects)).toEqual([]);
  });

  it("opens the linked file for a file intent", () => {
    // Given
    const { deps, controller, effects } = createFakeDeps();

    // When
    applyWorkbenchIntent(
      { open: "file", workspaceId: null, path: "src/a.ts" },
      deps,
    );

    // Then
    expect(effects.openFile).toHaveBeenCalledWith("src/a.ts");
    expect(calledNames(effects)).toEqual(["openFile"]);
    expect(calledNames(controller)).toEqual([]);
  });

  it("expands the folder in the ready workspace and shows the explorer for a folder intent", () => {
    // Given
    const { deps, controller, effects } = createFakeDeps();

    // When
    applyWorkbenchIntent(
      { open: "folder", workspaceId: null, path: "src/lib" },
      deps,
    );

    // Then
    expect(effects.expandFolder).toHaveBeenCalledWith(
      READY_WORKSPACE_ID,
      "src/lib",
    );
    expect(effects.setContextSidebarView).toHaveBeenCalledWith("explorer");
    expect([...calledNames(effects)].sort()).toEqual([
      "expandFolder",
      "setContextSidebarView",
    ]);
    expect(calledNames(controller)).toEqual([]);
  });

  it("shows the explorer for an explorer intent", () => {
    // Given
    const { deps, controller, effects } = createFakeDeps();

    // When
    applyWorkbenchIntent({ open: "explorer", workspaceId: null }, deps);

    // Then
    expect(effects.setContextSidebarView).toHaveBeenCalledWith("explorer");
    expect(calledNames(effects)).toEqual(["setContextSidebarView"]);
    expect(calledNames(controller)).toEqual([]);
  });

  it("shows find-in-files in the explorer for a search intent", () => {
    // Given
    const { deps, controller, effects } = createFakeDeps();

    // When
    applyWorkbenchIntent({ open: "search", workspaceId: null }, deps);

    // Then
    expect(effects.setContextSidebarView).toHaveBeenCalledWith("explorer");
    expect(effects.setContentSearchView).toHaveBeenCalledWith("search");
    expect([...calledNames(effects)].sort()).toEqual([
      "setContentSearchView",
      "setContextSidebarView",
    ]);
    expect(calledNames(controller)).toEqual([]);
  });

  it("opens a new terminal for a terminal intent", () => {
    // Given
    const { deps, controller, effects } = createFakeDeps();

    // When
    applyWorkbenchIntent({ open: "terminal", workspaceId: null }, deps);

    // Then
    expect(calledNames(controller)).toEqual(["openNewTerminal"]);
    expect(calledNames(effects)).toEqual([]);
  });
});
