import { describe, expect, it } from "vitest";

import type { WorkbenchTabParams } from "@/lib/workbench/tab-descriptors";

import { createFakeLayoutApi } from "./fake-layout-api";

const WORKSPACE_ID = "ws-1";

function fileParams(path: string): WorkbenchTabParams {
  return { kind: "file", workspaceId: WORKSPACE_ID, path };
}

const FULL_RECT = { left: 0, top: 0, width: 1000, height: 1000 };

describe("fake layout api movePanelToNewGroup (dockview 8.8.3 parity)", () => {
  it("leaves the layout unchanged when a group's only panel moves to that group's own edge", () => {
    // Given
    const api = createFakeLayoutApi({
      groups: [
        {
          id: "g1",
          rect: FULL_RECT,
          panels: [{ id: "a", params: fileParams("a.ts") }],
        },
      ],
    });
    const groupsBefore = api.getGroups();

    // When
    api.movePanelToNewGroup({
      panelId: "a",
      referenceGroupId: "g1",
      direction: "right",
    });

    // Then
    expect(api.getGroups()).toEqual(groupsBefore);
  });

  it("splits a new group off the reference group when the source group keeps other panels", () => {
    // Given
    const api = createFakeLayoutApi({
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
    api.movePanelToNewGroup({
      panelId: "b",
      referenceGroupId: "g1",
      direction: "right",
    });

    // Then
    const groups = api.getGroups();
    expect(groups.map((group) => group.panelIds)).toEqual([["a"], ["b"]]);
    expect(api.getPanel("b")?.groupId).not.toBe("g1");
  });
});
