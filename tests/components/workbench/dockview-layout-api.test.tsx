import { describe, expect, it } from "vitest";
import { act } from "@testing-library/react";

import { createDockviewRestoredPanelSource } from "@/components/workbench/dockview-layout-api";
import type { WorkbenchTabParams } from "@/lib/workbench/tab-descriptors";
import type { WorkbenchLayoutApi } from "@/lib/workbench/workbench-layout-api";

import { createFakeLayoutApi } from "../../lib/workbench/fake-layout-api";
import {
  createActDockviewLayoutApi,
  renderProbeDockview,
} from "./probe-dockview";

const WORKSPACE_ID = "ws-1";

function fileParams(path: string) {
  return {
    kind: "file",
    workspaceId: WORKSPACE_ID,
    path,
  } satisfies WorkbenchTabParams;
}

function addFile(
  layoutApi: WorkbenchLayoutApi,
  id: string,
  groupId: string | null,
) {
  layoutApi.addPanel({
    id,
    params: fileParams(`${id}.ts`),
    title: `${id}.ts`,
    groupId,
  });
}

function groupPanelIds(layoutApi: WorkbenchLayoutApi): string[][] {
  return layoutApi.getGroups().map((group) => group.panelIds);
}

function requireOnlyGroupId(layoutApi: WorkbenchLayoutApi): string {
  const [group] = layoutApi.getGroups();
  if (!group) throw new Error("expected a group");
  return group.id;
}

const LAYOUT_APIS: [string, () => WorkbenchLayoutApi][] = [
  ["fake layout api", () => createFakeLayoutApi()],
  [
    "dockview layout api",
    () => createActDockviewLayoutApi(renderProbeDockview()),
  ],
];

describe.each(LAYOUT_APIS)("%s contract", (_name, createLayoutApi) => {
  it("adds the first panel into a new group and makes it active", () => {
    // Given
    const layoutApi = createLayoutApi();

    // When
    addFile(layoutApi, "a", null);

    // Then
    expect(groupPanelIds(layoutApi)).toEqual([["a"]]);
    expect(layoutApi.getPanels()).toEqual([
      {
        id: "a",
        groupId: requireOnlyGroupId(layoutApi),
        params: fileParams("a.ts"),
      },
    ]);
    expect(layoutApi.getActivePanelId()).toBe("a");
  });

  it("adds a panel without a group into the active group", () => {
    // Given
    const layoutApi = createLayoutApi();
    addFile(layoutApi, "a", null);

    // When
    addFile(layoutApi, "b", null);

    // Then
    expect(groupPanelIds(layoutApi)).toEqual([["a", "b"]]);
    expect(layoutApi.getActivePanelId()).toBe("b");
  });

  it("adds a group with a panel beside the reference group", () => {
    // Given
    const layoutApi = createLayoutApi();
    addFile(layoutApi, "a", null);
    const referenceGroupId = requireOnlyGroupId(layoutApi);

    // When
    layoutApi.addGroupWithPanel({
      referenceGroupId,
      direction: "right",
      panel: { id: "b", params: fileParams("b.ts"), title: "b.ts" },
    });

    // Then
    expect(groupPanelIds(layoutApi)).toEqual([["a"], ["b"]]);
    expect(layoutApi.getPanel("b")?.groupId).not.toBe(referenceGroupId);
  });

  it("adds a panel into the requested group and activates that group", () => {
    // Given
    const layoutApi = createLayoutApi();
    addFile(layoutApi, "a", null);
    const firstGroupId = requireOnlyGroupId(layoutApi);
    layoutApi.addGroupWithPanel({
      referenceGroupId: firstGroupId,
      direction: "below",
      panel: { id: "b", params: fileParams("b.ts"), title: "b.ts" },
    });

    // When
    addFile(layoutApi, "c", firstGroupId);

    // Then
    expect(groupPanelIds(layoutApi)).toEqual([["a", "c"], ["b"]]);
    expect(layoutApi.getActiveGroupId()).toBe(firstGroupId);
    expect(layoutApi.getActivePanelId()).toBe("c");
  });

  it("moves a panel into another group and makes it the active panel", () => {
    // Given
    const layoutApi = createLayoutApi();
    addFile(layoutApi, "a", null);
    addFile(layoutApi, "b", null);
    const firstGroupId = requireOnlyGroupId(layoutApi);
    layoutApi.addGroupWithPanel({
      referenceGroupId: firstGroupId,
      direction: "right",
      panel: { id: "c", params: fileParams("c.ts"), title: "c.ts" },
    });
    const targetGroupId = layoutApi.getPanel("c")?.groupId ?? "";

    // When
    layoutApi.movePanelToGroup({ panelId: "a", groupId: targetGroupId });

    // Then
    expect(groupPanelIds(layoutApi)).toEqual([["b"], ["c", "a"]]);
    expect(layoutApi.getActiveGroupId()).toBe(targetGroupId);
    expect(layoutApi.getActivePanelId()).toBe("a");
  });

  it("splits a panel off a multi-panel group into a new group", () => {
    // Given
    const layoutApi = createLayoutApi();
    addFile(layoutApi, "a", null);
    addFile(layoutApi, "b", null);
    const sourceGroupId = requireOnlyGroupId(layoutApi);

    // When
    layoutApi.movePanelToNewGroup({
      panelId: "b",
      referenceGroupId: sourceGroupId,
      direction: "right",
    });

    // Then
    expect(groupPanelIds(layoutApi)).toEqual([["a"], ["b"]]);
    expect(layoutApi.getPanel("b")?.groupId).not.toBe(sourceGroupId);
    expect(layoutApi.getActivePanelId()).toBe("b");
  });

  it("ignores moving a group's only panel to that group's own edge", () => {
    // Given
    const layoutApi = createLayoutApi();
    addFile(layoutApi, "a", null);
    const groupId = requireOnlyGroupId(layoutApi);

    // When
    layoutApi.movePanelToNewGroup({
      panelId: "a",
      referenceGroupId: groupId,
      direction: "right",
    });

    // Then
    expect(groupPanelIds(layoutApi)).toEqual([["a"]]);
    expect(layoutApi.getPanel("a")?.groupId).toBe(groupId);
  });

  it("replaces a panel's params", () => {
    // Given
    const layoutApi = createLayoutApi();
    layoutApi.addPanel({
      id: "chat",
      params: { kind: "chat", workspaceId: WORKSPACE_ID, sessionId: null },
      title: "New chat",
      groupId: null,
    });
    const retargeted = {
      kind: "chat",
      workspaceId: WORKSPACE_ID,
      sessionId: "s1",
    } satisfies WorkbenchTabParams;

    // When
    layoutApi.updatePanelParams("chat", retargeted, "Fix bug");

    // Then
    expect(layoutApi.getPanel("chat")?.params).toEqual(retargeted);
  });

  it("removes a panel and drops the group it emptied", () => {
    // Given
    const layoutApi = createLayoutApi();
    addFile(layoutApi, "a", null);
    layoutApi.addGroupWithPanel({
      referenceGroupId: requireOnlyGroupId(layoutApi),
      direction: "right",
      panel: { id: "b", params: fileParams("b.ts"), title: "b.ts" },
    });

    // When
    layoutApi.removePanel("b");

    // Then
    expect(groupPanelIds(layoutApi)).toEqual([["a"]]);
    expect(layoutApi.getPanel("b")).toBeNull();
  });

  it("activates a panel in a background group", () => {
    // Given
    const layoutApi = createLayoutApi();
    addFile(layoutApi, "a", null);
    addFile(layoutApi, "b", null);
    const firstGroupId = requireOnlyGroupId(layoutApi);
    layoutApi.addGroupWithPanel({
      referenceGroupId: firstGroupId,
      direction: "right",
      panel: { id: "c", params: fileParams("c.ts"), title: "c.ts" },
    });

    // When
    layoutApi.activatePanel("a");

    // Then
    expect(layoutApi.getActiveGroupId()).toBe(firstGroupId);
    expect(layoutApi.getActivePanelId()).toBe("a");
  });

  it("activates another group with its own active panel", () => {
    // Given
    const layoutApi = createLayoutApi();
    addFile(layoutApi, "a", null);
    const firstGroupId = requireOnlyGroupId(layoutApi);
    layoutApi.addGroupWithPanel({
      referenceGroupId: firstGroupId,
      direction: "right",
      panel: { id: "b", params: fileParams("b.ts"), title: "b.ts" },
    });

    // When
    layoutApi.activateGroup(firstGroupId);

    // Then
    expect(layoutApi.getActiveGroupId()).toBe(firstGroupId);
    expect(layoutApi.getActivePanelId()).toBe("a");
  });
});

describe("createDockviewLayoutApi dockview mapping", () => {
  it("adds panels with the kind as component and the always renderer", () => {
    // Given
    const api = renderProbeDockview();
    const layoutApi = createActDockviewLayoutApi(api);

    // When
    addFile(layoutApi, "a", null);

    // Then
    const panel = api.getPanel("a");
    expect(panel?.api.component).toBe("file");
    expect(panel?.api.renderer).toBe("always");
    expect(panel?.title).toBe("a.ts");
  });

  it("keeps the same panel instance when moving it to another group", () => {
    // Given
    const api = renderProbeDockview();
    const layoutApi = createActDockviewLayoutApi(api);
    addFile(layoutApi, "a", null);
    addFile(layoutApi, "b", null);
    layoutApi.addGroupWithPanel({
      referenceGroupId: requireOnlyGroupId(layoutApi),
      direction: "right",
      panel: { id: "c", params: fileParams("c.ts"), title: "c.ts" },
    });
    const panelBeforeMove = api.getPanel("a");

    // When
    layoutApi.movePanelToGroup({
      panelId: "a",
      groupId: layoutApi.getPanel("c")?.groupId ?? "",
    });

    // Then
    expect(api.getPanel("a")).toBe(panelBeforeMove);
  });

  it("sets the dockview title when params are replaced", () => {
    // Given
    const api = renderProbeDockview();
    const layoutApi = createActDockviewLayoutApi(api);
    addFile(layoutApi, "a", null);

    // When
    layoutApi.updatePanelParams("a", fileParams("renamed.ts"), "renamed.ts");

    // Then
    expect(api.getPanel("a")?.title).toBe("renamed.ts");
  });

  it("ignores removing a panel that is already gone", () => {
    // Given
    const api = renderProbeDockview();
    const layoutApi = createActDockviewLayoutApi(api);
    addFile(layoutApi, "a", null);

    // When
    layoutApi.removePanel("tab-gone");

    // Then
    expect(groupPanelIds(layoutApi)).toEqual([["a"]]);
  });

  it("hides panels with invalid params from the contract but lists them for restore", () => {
    // Given
    const api = renderProbeDockview();
    const layoutApi = createActDockviewLayoutApi(api);
    addFile(layoutApi, "a", null);
    act(() => {
      api.addPanel({
        id: "broken",
        component: "file",
        params: { kind: "file" },
      });
    });

    // When
    const restoredPanels = createDockviewRestoredPanelSource(api).getPanels();

    // Then
    expect(layoutApi.getPanels().map((panel) => panel.id)).toEqual(["a"]);
    expect(layoutApi.getPanel("broken")).toBeNull();
    expect(restoredPanels).toEqual([
      { id: "a", params: fileParams("a.ts") },
      { id: "broken", params: { kind: "file" } },
    ]);
  });

  it("removes a restored panel through the restore source", () => {
    // Given
    const api = renderProbeDockview();
    act(() => {
      api.addPanel({
        id: "broken",
        component: "file",
        params: { kind: "file" },
      });
    });
    const restoredSource = createDockviewRestoredPanelSource(api);

    // When
    act(() => restoredSource.removePanel("broken"));

    // Then
    expect(api.panels).toEqual([]);
  });
});
