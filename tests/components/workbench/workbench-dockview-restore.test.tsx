import { beforeEach, describe, expect, it } from "vitest";
import {
  Orientation,
  type DockviewApi,
  type SerializedDockview,
} from "dockview-react";

import { createDockviewLayoutApi } from "@/components/workbench/dockview-layout-api";
import { restoreWorkbenchDockview } from "@/components/workbench/workbench-dockview-restore";
import type { WorkbenchTabParams } from "@/lib/workbench/tab-descriptors";
import type { WorkbenchLayoutApi } from "@/lib/workbench/workbench-layout-api";
import { useChatStore } from "@/stores/chat-store";
import { layoutStorageKey, useWorkbenchStore } from "@/stores/workbench-store";

import { renderProbeDockview } from "./probe-dockview";

const WORKSPACE_ID = "ws-1";
const OTHER_WORKSPACE_ID = "ws-2";

function fileParams(path: string, workspaceId = WORKSPACE_ID) {
  return { kind: "file", workspaceId, path } satisfies WorkbenchTabParams;
}

function chatParams(sessionId: string | null) {
  return {
    kind: "chat",
    workspaceId: WORKSPACE_ID,
    sessionId,
  } satisfies WorkbenchTabParams;
}

function buildSavedLayout(
  build: (layoutApi: WorkbenchLayoutApi, api: DockviewApi) => void,
): SerializedDockview {
  const api = renderProbeDockview((readyApi) =>
    build(createDockviewLayoutApi(readyApi), readyApi),
  );
  return api.toJSON();
}

function requireFirstGroupId(layoutApi: WorkbenchLayoutApi): string {
  const [group] = layoutApi.getGroups();
  if (!group) throw new Error("expected a group");
  return group.id;
}

function splitLayout(leftPanelId: string, rightPanelId: string) {
  return buildSavedLayout((layoutApi) => {
    layoutApi.addPanel({
      id: leftPanelId,
      params: fileParams(`${leftPanelId}.ts`),
      title: leftPanelId,
      groupId: null,
    });
    layoutApi.addGroupWithPanel({
      referenceGroupId: requireFirstGroupId(layoutApi),
      direction: "right",
      panel: {
        id: rightPanelId,
        params: fileParams(`${rightPanelId}.ts`),
        title: rightPanelId,
      },
    });
  });
}

const gridSize = { width: 800, height: 600 };

// dockview rejects a non-branch root: fromJSON throws.
const leafRootLayout: SerializedDockview = {
  grid: {
    root: { type: "leaf", data: { id: "1", views: [] }, size: 800 },
    ...gridSize,
    orientation: Orientation.HORIZONTAL,
  },
  panels: {},
};

// dockview tolerates this one: its only group shows a panel that has no state.
const danglingPanelLayout: SerializedDockview = {
  grid: {
    root: {
      type: "branch",
      data: [
        {
          type: "leaf",
          data: { id: "1", views: ["ghost"], activeView: "ghost" },
          size: 800,
        },
      ],
      size: 600,
    },
    ...gridSize,
    orientation: Orientation.HORIZONTAL,
  },
  panels: {},
};

function saveLayout(isMobile: boolean, layout: SerializedDockview) {
  useWorkbenchStore
    .getState()
    .saveLayout(layoutStorageKey(WORKSPACE_ID, isMobile), layout);
}

// The restore runs inside dockview's ready callback, as in WorkbenchDockview.
function restoreIntoFreshDockview(isMobile: boolean) {
  const api = renderProbeDockview((readyApi) =>
    restoreWorkbenchDockview({
      api: readyApi,
      workspaceId: WORKSPACE_ID,
      isMobile,
    }),
  );
  return createDockviewLayoutApi(api);
}

beforeEach(() => {
  localStorage.clear();
  useWorkbenchStore.setState(useWorkbenchStore.getInitialState(), true);
  useChatStore.setState({
    activeWorkspaceId: WORKSPACE_ID,
    activeSessionId: "s-active",
    workspaceStates: {},
  });
});

describe("restoreWorkbenchDockview", () => {
  it("restores the saved desktop layout of the workspace", () => {
    // Given
    saveLayout(false, splitLayout("a", "b"));

    // When
    const layoutApi = restoreIntoFreshDockview(false);

    // Then
    expect(layoutApi.getGroups().map((group) => group.panelIds)).toEqual([
      ["a"],
      ["b"],
    ]);
  });

  it("removes invalid and foreign-workspace panels from the restored layout", () => {
    // Given
    const savedLayout = buildSavedLayout((layoutApi, api) => {
      layoutApi.addPanel({
        id: "own",
        params: fileParams("own.ts"),
        title: "own.ts",
        groupId: null,
      });
      layoutApi.addPanel({
        id: "foreign",
        params: fileParams("foreign.ts", OTHER_WORKSPACE_ID),
        title: "foreign.ts",
        groupId: null,
      });
      api.addPanel({
        id: "invalid",
        component: "file",
        params: { kind: "file" },
      });
    });
    saveLayout(false, savedLayout);

    // When
    const restoredLayoutApi = restoreIntoFreshDockview(false);

    // Then
    expect(restoredLayoutApi.getPanels()).toEqual([
      { id: "own", groupId: expect.any(String), params: fileParams("own.ts") },
    ]);
  });

  it.each([
    ["is rejected by dockview", leafRootLayout],
    ["points at a panel it does not describe", danglingPanelLayout],
  ])(
    "falls back to the default chat panel when the saved layout %s",
    (_label, corruptLayout) => {
      // Given
      saveLayout(false, corruptLayout);

      // When
      const layoutApi = restoreIntoFreshDockview(false);

      // Then
      expect(layoutApi.getPanels()).toEqual([
        {
          id: expect.any(String),
          groupId: expect.any(String),
          params: chatParams("s-active"),
        },
      ]);
    },
  );

  it("opens an empty chat when nothing is saved and the active chat is another workspace's", () => {
    // Given
    useChatStore.setState({
      activeWorkspaceId: OTHER_WORKSPACE_ID,
      activeSessionId: "s-elsewhere",
    });

    // When
    const layoutApi = restoreIntoFreshDockview(false);

    // Then
    expect(layoutApi.getPanels().map((panel) => panel.params)).toEqual([
      chatParams(null),
    ]);
  });

  it("restores the mobile layout key into a single group", () => {
    // Given
    saveLayout(false, splitLayout("desktop-a", "desktop-b"));
    saveLayout(true, splitLayout("mobile-a", "mobile-b"));

    // When
    const layoutApi = restoreIntoFreshDockview(true);

    // Then
    expect(layoutApi.getGroups().map((group) => group.panelIds)).toEqual([
      ["mobile-a", "mobile-b"],
    ]);
  });
});
