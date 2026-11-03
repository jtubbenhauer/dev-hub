import { describe, expect, it } from "vitest";

import {
  collapseToSingleGroup,
  ensureDefaultPanel,
  sanitizeRestoredPanels,
  type RestoredPanelSnapshot,
} from "@/components/workbench/workbench-layout-restore";
import type { WorkbenchTabParams } from "@/lib/workbench/tab-descriptors";

import { createFakeLayoutApi } from "../../lib/workbench/fake-layout-api";

const WORKSPACE_ID = "ws-1";
const OTHER_WORKSPACE_ID = "ws-2";
const FULL_RECT = { left: 0, top: 0, width: 1000, height: 1000 };

function fileParams(path: string, workspaceId = WORKSPACE_ID) {
  return { kind: "file", workspaceId, path } satisfies WorkbenchTabParams;
}

const defaultChatParams = {
  kind: "chat",
  workspaceId: WORKSPACE_ID,
  sessionId: "s1",
} satisfies WorkbenchTabParams;

function createRestoredSource(initialPanels: RestoredPanelSnapshot[]) {
  let panels = [...initialPanels];
  return {
    getPanels: () => panels,
    removePanel: (id: string) => {
      panels = panels.filter((panel) => panel.id !== id);
    },
    remainingIds: () => panels.map((panel) => panel.id),
  };
}

describe("sanitizeRestoredPanels", () => {
  it("keeps every valid panel of the workspace and removes nothing", () => {
    // Given
    const layoutApi = createFakeLayoutApi({
      groups: [
        {
          id: "g1",
          rect: FULL_RECT,
          panels: [
            { id: "file-a", params: fileParams("a.ts") },
            { id: "chat-1", params: defaultChatParams },
          ],
        },
      ],
    });

    // When
    const removedIds = sanitizeRestoredPanels(layoutApi, WORKSPACE_ID);

    // Then
    expect(removedIds).toEqual([]);
    expect(layoutApi.getPanels().map((panel) => panel.id)).toEqual([
      "file-a",
      "chat-1",
    ]);
  });

  it("removes panels whose params are not valid workbench tab params", () => {
    // Given
    const source = createRestoredSource([
      { id: "valid", params: fileParams("a.ts") },
      { id: "no-params", params: undefined },
      {
        id: "unknown-kind",
        params: { kind: "bogus", workspaceId: WORKSPACE_ID },
      },
      {
        id: "default-terminal",
        params: {
          kind: "terminal",
          workspaceId: WORKSPACE_ID,
          sessionId: "default",
          title: "Terminal 1",
        },
      },
    ]);

    // When
    const removedIds = sanitizeRestoredPanels(source, WORKSPACE_ID);

    // Then
    expect(removedIds).toEqual([
      "no-params",
      "unknown-kind",
      "default-terminal",
    ]);
    expect(source.remainingIds()).toEqual(["valid"]);
  });

  it("removes panels that belong to another workspace", () => {
    // Given
    const layoutApi = createFakeLayoutApi({
      groups: [
        {
          id: "g1",
          rect: FULL_RECT,
          panels: [
            { id: "own", params: fileParams("a.ts") },
            {
              id: "foreign",
              params: fileParams("b.ts", OTHER_WORKSPACE_ID),
            },
          ],
        },
      ],
    });

    // When
    const removedIds = sanitizeRestoredPanels(layoutApi, WORKSPACE_ID);

    // Then
    expect(removedIds).toEqual(["foreign"]);
    expect(layoutApi.getPanels().map((panel) => panel.id)).toEqual(["own"]);
  });
});

describe("ensureDefaultPanel", () => {
  it("adds the default chat panel when the layout has no panels", () => {
    // Given
    const layoutApi = createFakeLayoutApi();

    // When
    const panelId = ensureDefaultPanel(layoutApi, defaultChatParams, "Chat");

    // Then
    expect(panelId).not.toBeNull();
    expect(layoutApi.getPanels()).toEqual([
      { id: panelId, groupId: expect.any(String), params: defaultChatParams },
    ]);
    expect(layoutApi.getActivePanelId()).toBe(panelId);
  });

  it("leaves a layout that already has panels untouched", () => {
    // Given
    const layoutApi = createFakeLayoutApi({
      groups: [
        {
          id: "g1",
          rect: FULL_RECT,
          panels: [{ id: "file-a", params: fileParams("a.ts") }],
        },
      ],
    });

    // When
    const panelId = ensureDefaultPanel(layoutApi, defaultChatParams, "Chat");

    // Then
    expect(panelId).toBeNull();
    expect(layoutApi.mutations).toEqual([]);
  });
});

describe("collapseToSingleGroup", () => {
  it("moves every panel into the first group and keeps the active panel active", () => {
    // Given
    const layoutApi = createFakeLayoutApi({
      groups: [
        {
          id: "g1",
          rect: { ...FULL_RECT, width: 500 },
          panels: [{ id: "a", params: fileParams("a.ts") }],
        },
        {
          id: "g2",
          rect: { ...FULL_RECT, left: 500, width: 500 },
          panels: [
            { id: "b", params: fileParams("b.ts") },
            { id: "c", params: fileParams("c.ts") },
          ],
          activePanelId: "b",
        },
      ],
      activeGroupId: "g2",
    });

    // When
    collapseToSingleGroup(layoutApi);

    // Then
    expect(layoutApi.getGroups().map((group) => group.panelIds)).toEqual([
      ["a", "b", "c"],
    ]);
    expect(layoutApi.getActivePanelId()).toBe("b");
  });

  it("does nothing when the layout already has a single group", () => {
    // Given
    const layoutApi = createFakeLayoutApi({
      groups: [
        {
          id: "g1",
          rect: FULL_RECT,
          panels: [
            { id: "a", params: fileParams("a.ts") },
            { id: "b", params: fileParams("b.ts") },
          ],
        },
      ],
    });

    // When
    collapseToSingleGroup(layoutApi);

    // Then
    expect(layoutApi.mutations).toEqual([]);
  });
});
