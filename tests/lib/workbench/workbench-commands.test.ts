import { describe, expect, it } from "vitest";

import type { WorkbenchTabParams } from "@/lib/workbench/tab-descriptors";
import type {
  WorkbenchGroupRect,
  WorkbenchGroupRef,
  WorkbenchPanelRef,
} from "@/lib/workbench/workbench-layout-api";
import {
  applyChatTarget,
  cycleTab,
  findPanelByResource,
  focusAdjacentGroup,
  focusTabNumber,
  getActivePanel,
  moveActivePanelToAdjacentGroup,
  openOrFocusTab,
  pickAdjacentGroup,
  resolveChatTarget,
  splitActiveGroup,
} from "@/lib/workbench/workbench-commands";

import { createFakeLayoutApi, type FakePanelSeed } from "./fake-layout-api";

const WORKSPACE_ID = "ws-1";

function fileParams(path: string): WorkbenchTabParams {
  return { kind: "file", workspaceId: WORKSPACE_ID, path };
}

function chatParams(sessionId: string | null): WorkbenchTabParams {
  return { kind: "chat", workspaceId: WORKSPACE_ID, sessionId };
}

const launcherParams: WorkbenchTabParams = {
  kind: "launcher",
  workspaceId: WORKSPACE_ID,
};

function filePanel(id: string): FakePanelSeed {
  return { id, params: fileParams(`${id}.ts`) };
}

function rect(
  left: number,
  top: number,
  width = 100,
  height = 100,
): WorkbenchGroupRect {
  return { left, top, width, height };
}

function singleGroupApi(panelIds: string[], activePanelId?: string) {
  return createFakeLayoutApi({
    groups: [
      {
        id: "g1",
        rect: rect(0, 0, 1000, 1000),
        panels: panelIds.map(filePanel),
        activePanelId,
      },
    ],
  });
}

function group(id: string, groupRect: WorkbenchGroupRect): WorkbenchGroupRef {
  return {
    id,
    panelIds: [`${id}-p`],
    activePanelId: `${id}-p`,
    rect: groupRect,
  };
}

const twoByTwoGrid: WorkbenchGroupRef[] = [
  group("top-left", rect(0, 0)),
  group("top-right", rect(100, 0)),
  group("bottom-left", rect(0, 100)),
  group("bottom-right", rect(100, 100)),
];

describe("findPanelByResource", () => {
  it("finds an open panel showing the same resource", () => {
    const api = singleGroupApi(["a", "b"]);

    expect(findPanelByResource(api, fileParams("b.ts"))?.id).toBe("b");
  });

  it("returns null when the resource is not open", () => {
    const api = singleGroupApi(["a"]);

    expect(findPanelByResource(api, fileParams("zzz.ts"))).toBeNull();
  });

  it("never matches launcher params", () => {
    const api = createFakeLayoutApi({
      groups: [
        {
          id: "g1",
          rect: rect(0, 0),
          panels: [{ id: "launch", params: launcherParams }],
        },
      ],
    });

    expect(findPanelByResource(api, launcherParams)).toBeNull();
  });

  it("never matches a new (null-session) chat", () => {
    const api = createFakeLayoutApi({
      groups: [
        {
          id: "g1",
          rect: rect(0, 0),
          panels: [{ id: "new-chat", params: chatParams(null) }],
        },
      ],
    });

    expect(findPanelByResource(api, chatParams(null))).toBeNull();
  });
});

describe("openOrFocusTab", () => {
  it("keeps one panel when the same resource is opened twice", () => {
    const api = createFakeLayoutApi();

    const firstId = openOrFocusTab(api, fileParams("a.ts"), "a.ts");
    const secondId = openOrFocusTab(api, fileParams("a.ts"), "a.ts");

    expect(secondId).toBe(firstId);
    expect(api.getPanels()).toHaveLength(1);
  });

  it("focuses the existing panel instead of adding a new one", () => {
    const api = singleGroupApi(["a", "b"], "b");

    const panelId = openOrFocusTab(api, fileParams("a.ts"), "a.ts");

    expect(panelId).toBe("a");
    expect(api.getActivePanelId()).toBe("a");
  });

  it("adds a new panel to the active group and activates it", () => {
    const api = singleGroupApi(["a"]);

    const panelId = openOrFocusTab(api, fileParams("new.ts"), "new.ts");

    expect(api.getPanel(panelId)?.groupId).toBe("g1");
    expect(api.getActivePanelId()).toBe(panelId);
    expect(api.getTitle(panelId)).toBe("new.ts");
  });

  it("adds the panel to the requested group", () => {
    const api = createFakeLayoutApi({
      groups: [
        { id: "g1", rect: rect(0, 0), panels: [filePanel("a")] },
        { id: "g2", rect: rect(100, 0), panels: [filePanel("b")] },
      ],
      activeGroupId: "g1",
    });

    const panelId = openOrFocusTab(api, fileParams("new.ts"), "new.ts", {
      groupId: "g2",
    });

    expect(api.getPanel(panelId)?.groupId).toBe("g2");
  });

  it("removes the launcher when opening into a launcher-only group", () => {
    const api = createFakeLayoutApi({
      groups: [
        { id: "g1", rect: rect(0, 0), panels: [filePanel("a")] },
        {
          id: "g2",
          rect: rect(100, 0),
          panels: [{ id: "launch", params: launcherParams }],
        },
      ],
      activeGroupId: "g2",
    });

    const panelId = openOrFocusTab(api, fileParams("new.ts"), "new.ts");

    expect(api.getPanel("launch")).toBeNull();
    expect(api.getGroups().find((g) => g.id === "g2")?.panelIds).toEqual([
      panelId,
    ]);
    expect(api.getActivePanelId()).toBe(panelId);
  });

  it("keeps a launcher that shares its group with other tabs", () => {
    const api = createFakeLayoutApi({
      groups: [
        {
          id: "g1",
          rect: rect(0, 0),
          panels: [filePanel("a"), { id: "launch", params: launcherParams }],
        },
      ],
    });

    openOrFocusTab(api, fileParams("new.ts"), "new.ts");

    expect(api.getPanel("launch")).not.toBeNull();
  });
});

describe("cycleTab", () => {
  it("moves to the next tab", () => {
    const api = singleGroupApi(["a", "b", "c"], "a");

    cycleTab(api, "next");

    expect(api.getActivePanelId()).toBe("b");
  });

  it("wraps from the last tab to the first on next", () => {
    const api = singleGroupApi(["a", "b", "c"], "c");

    cycleTab(api, "next");

    expect(api.getActivePanelId()).toBe("a");
  });

  it("wraps from the first tab to the last on previous", () => {
    const api = singleGroupApi(["a", "b", "c"], "a");

    cycleTab(api, "previous");

    expect(api.getActivePanelId()).toBe("c");
  });

  it("stays within the active group", () => {
    const api = createFakeLayoutApi({
      groups: [
        {
          id: "g1",
          rect: rect(0, 0),
          panels: [filePanel("a"), filePanel("b")],
        },
        { id: "g2", rect: rect(100, 0), panels: [filePanel("c")] },
      ],
      activeGroupId: "g1",
    });
    api.activatePanel("b");

    cycleTab(api, "next");

    expect(api.getActivePanelId()).toBe("a");
  });

  it("is a no-op without an active group", () => {
    const api = createFakeLayoutApi();

    cycleTab(api, "next");

    expect(api.mutations).toEqual([]);
  });
});

describe("focusTabNumber", () => {
  it("focuses the tab at the 1-based index", () => {
    const api = singleGroupApi(["a", "b", "c"], "a");

    focusTabNumber(api, 2);

    expect(api.getActivePanelId()).toBe("b");
  });

  it("focuses the last tab for 9", () => {
    const api = singleGroupApi(["a", "b", "c"], "a");

    focusTabNumber(api, 9);

    expect(api.getActivePanelId()).toBe("c");
  });

  it("is a no-op when the index is past the last tab", () => {
    const api = singleGroupApi(["a", "b", "c"], "b");

    focusTabNumber(api, 5);

    expect(api.getActivePanelId()).toBe("b");
    expect(api.mutations).toEqual([]);
  });

  it("is a no-op for numbers outside 1..9", () => {
    const api = singleGroupApi(["a", "b", "c"], "b");

    focusTabNumber(api, 0);
    focusTabNumber(api, 10);

    expect(api.mutations).toEqual([]);
  });
});

describe("getActivePanel", () => {
  it("returns the active panel ref", () => {
    const api = singleGroupApi(["a", "b"], "b");

    expect(getActivePanel(api)).toEqual({
      id: "b",
      groupId: "g1",
      params: fileParams("b.ts"),
    });
  });

  it("returns null for an empty layout", () => {
    expect(getActivePanel(createFakeLayoutApi())).toBeNull();
  });
});

describe("splitActiveGroup", () => {
  it("creates a group to the right with a launcher and activates it", () => {
    const api = singleGroupApi(["a"]);

    const launcherId = splitActiveGroup(api, "right");

    const groups = api.getGroups();
    const original = groups.find((g) => g.id === "g1");
    const created = groups.find((g) => g.id !== "g1");
    if (!original || !created || launcherId === null) {
      throw new Error("expected the split to add a launcher group");
    }
    expect(groups).toHaveLength(2);
    expect(created.panelIds).toEqual([launcherId]);
    expect(created.rect.left).toBeGreaterThanOrEqual(
      original.rect.left + original.rect.width,
    );
    expect(api.getPanel(launcherId)?.params).toEqual(launcherParams);
    expect(api.getTitle(launcherId)).toBe("New tab");
    expect(api.getActiveGroupId()).toBe(created.id);
    expect(api.getActivePanelId()).toBe(launcherId);
  });

  it("creates a group below", () => {
    const api = singleGroupApi(["a"]);

    splitActiveGroup(api, "below");

    const created = api.getGroups().find((g) => g.id !== "g1");
    expect(created?.rect.top).toBeGreaterThan(0);
  });

  it("is a no-op without an active group", () => {
    const api = createFakeLayoutApi();

    expect(splitActiveGroup(api, "right")).toBeNull();
    expect(api.mutations).toEqual([]);
  });
});

describe("pickAdjacentGroup", () => {
  it.each([
    ["top-left", "right", "top-right"],
    ["top-left", "down", "bottom-left"],
    ["bottom-right", "left", "bottom-left"],
    ["bottom-right", "up", "top-right"],
  ] as const)("from %s going %s picks %s", (from, direction, expected) => {
    expect(pickAdjacentGroup(twoByTwoGrid, from, direction)?.id).toBe(expected);
  });

  it("returns null at the layout edge", () => {
    expect(pickAdjacentGroup(twoByTwoGrid, "top-left", "left")).toBeNull();
    expect(pickAdjacentGroup(twoByTwoGrid, "top-left", "up")).toBeNull();
  });

  it("returns null for an unknown or missing active group", () => {
    expect(pickAdjacentGroup(twoByTwoGrid, null, "right")).toBeNull();
    expect(pickAdjacentGroup(twoByTwoGrid, "nope", "right")).toBeNull();
  });

  it("prefers the nearer edge over a farther group", () => {
    const groups = [
      group("active", rect(0, 0)),
      group("far", rect(300, 0)),
      group("near", rect(100, 0)),
    ];

    expect(pickAdjacentGroup(groups, "active", "right")?.id).toBe("near");
  });

  it("breaks an edge-gap tie by the larger perpendicular overlap", () => {
    const groups = [
      group("active", rect(0, 0, 100, 200)),
      group("small-overlap", rect(100, 150, 100, 100)),
      group("big-overlap", rect(100, 0, 100, 150)),
    ];

    expect(pickAdjacentGroup(groups, "active", "right")?.id).toBe(
      "big-overlap",
    );
  });

  it("tolerates a 1px overlap on the requested side", () => {
    const groups = [group("active", rect(0, 0)), group("right", rect(99, 0))];

    expect(pickAdjacentGroup(groups, "active", "right")?.id).toBe("right");
  });
});

describe("focusAdjacentGroup", () => {
  it("activates the group on the requested side", () => {
    const api = createFakeLayoutApi({
      groups: [
        { id: "g1", rect: rect(0, 0), panels: [filePanel("a")] },
        { id: "g2", rect: rect(100, 0), panels: [filePanel("b")] },
      ],
      activeGroupId: "g1",
    });

    focusAdjacentGroup(api, "right");

    expect(api.getActiveGroupId()).toBe("g2");
  });

  it("is a no-op when there is no group on that side", () => {
    const api = singleGroupApi(["a"]);

    focusAdjacentGroup(api, "left");

    expect(api.mutations).toEqual([]);
  });
});

describe("moveActivePanelToAdjacentGroup", () => {
  it("moves the active panel into the adjacent group", () => {
    const api = createFakeLayoutApi({
      groups: [
        {
          id: "g1",
          rect: rect(0, 0),
          panels: [filePanel("a"), filePanel("b")],
        },
        { id: "g2", rect: rect(100, 0), panels: [filePanel("c")] },
      ],
      activeGroupId: "g1",
    });
    api.activatePanel("b");

    moveActivePanelToAdjacentGroup(api, "right");

    expect(api.getPanel("b")?.groupId).toBe("g2");
    expect(api.mutations).toContain("movePanelToGroup");
  });

  it("drops the adjacent group's lone launcher once a tab moves in", () => {
    // Given
    const api = createFakeLayoutApi({
      groups: [
        {
          id: "g1",
          rect: rect(0, 0),
          panels: [filePanel("a"), filePanel("b")],
        },
        {
          id: "g2",
          rect: rect(100, 0),
          panels: [{ id: "launcher", params: launcherParams }],
        },
      ],
      activeGroupId: "g1",
    });
    api.activatePanel("b");

    // When
    moveActivePanelToAdjacentGroup(api, "right");

    // Then
    expect(api.getGroups().map((entry) => entry.panelIds)).toEqual([
      ["a"],
      ["b"],
    ]);
    expect(api.getActivePanelId()).toBe("b");
  });

  it("moves right into a new group keeping the panel id when none exists", () => {
    const api = singleGroupApi(["a", "b"], "b");

    moveActivePanelToAdjacentGroup(api, "right");

    const moved = api.getPanel("b");
    expect(moved?.groupId).not.toBe("g1");
    expect(api.getGroups()).toHaveLength(2);
    expect(api.mutations).toContain("movePanelToNewGroup");
    expect(api.mutations).not.toContain("removePanel");
    expect(api.mutations).not.toContain("addPanel");
    expect(api.getActivePanelId()).toBe("b");
  });

  it("is a no-op moving left when there is no left group", () => {
    const api = singleGroupApi(["a", "b"], "b");

    moveActivePanelToAdjacentGroup(api, "left");

    expect(api.mutations).toEqual([]);
    expect(api.getPanel("b")?.groupId).toBe("g1");
  });

  it("is a no-op moving right when the lone panel has no right group", () => {
    const api = singleGroupApi(["a"]);

    moveActivePanelToAdjacentGroup(api, "right");

    expect(api.mutations).toEqual([]);
  });
});

describe("resolveChatTarget", () => {
  const panels: WorkbenchPanelRef[] = [
    { id: "chat-1", groupId: "g1", params: chatParams("ses-1") },
    { id: "chat-new", groupId: "g1", params: chatParams(null) },
    { id: "file-1", groupId: "g1", params: fileParams("a.ts") },
  ];

  it("focuses the panel already showing the session", () => {
    expect(
      resolveChatTarget(panels, { sessionId: "ses-1", panelId: "chat-new" }),
    ).toEqual({ action: "focus", panelId: "chat-1" });
  });

  it("retargets the requesting chat panel", () => {
    expect(
      resolveChatTarget(panels, { sessionId: "ses-2", panelId: "chat-new" }),
    ).toEqual({ action: "retarget", panelId: "chat-new" });
  });

  it("opens when no panel is named", () => {
    expect(
      resolveChatTarget(panels, { sessionId: "ses-2", panelId: null }),
    ).toEqual({ action: "open" });
  });

  it("opens when the named panel is not a chat panel", () => {
    expect(
      resolveChatTarget(panels, { sessionId: "ses-2", panelId: "file-1" }),
    ).toEqual({ action: "open" });
  });
});

describe("applyChatTarget", () => {
  function chatLayout() {
    return createFakeLayoutApi({
      groups: [
        {
          id: "g1",
          rect: rect(0, 0),
          panels: [
            { id: "chat-1", params: chatParams("ses-1") },
            { id: "chat-new", params: chatParams(null) },
            filePanel("a"),
          ],
          activePanelId: "a",
        },
      ],
    });
  }

  it("focuses the panel already showing the session", () => {
    const api = chatLayout();

    const panelId = applyChatTarget(
      api,
      { workspaceId: WORKSPACE_ID, sessionId: "ses-1", panelId: null },
      "Chat",
    );

    expect(panelId).toBe("chat-1");
    expect(api.getActivePanelId()).toBe("chat-1");
  });

  it("retargets without changing the active panel", () => {
    const api = chatLayout();

    const panelId = applyChatTarget(
      api,
      { workspaceId: WORKSPACE_ID, sessionId: "ses-2", panelId: "chat-new" },
      "New session",
    );

    expect(panelId).toBe("chat-new");
    expect(api.getPanel("chat-new")?.params).toEqual(chatParams("ses-2"));
    expect(api.getTitle("chat-new")).toBe("New session");
    expect(api.getActivePanelId()).toBe("a");
  });

  it("opens and activates a new chat panel", () => {
    const api = chatLayout();

    const panelId = applyChatTarget(
      api,
      { workspaceId: WORKSPACE_ID, sessionId: "ses-3", panelId: null },
      "Third",
    );

    expect(api.getPanel(panelId)?.params).toEqual(chatParams("ses-3"));
    expect(api.getActivePanelId()).toBe(panelId);
    expect(api.getPanels()).toHaveLength(4);
  });
});

describe("fake layout api", () => {
  it("throws on a duplicate panel id like dockview", () => {
    const api = singleGroupApi(["a"]);

    expect(() =>
      api.addPanel({
        id: "a",
        params: fileParams("x"),
        title: "x",
        groupId: null,
      }),
    ).toThrow("panel with id a already exists");
    expect(() =>
      api.addGroupWithPanel({
        referenceGroupId: "g1",
        direction: "right",
        panel: { id: "a", params: fileParams("x"), title: "x" },
      }),
    ).toThrow("panel with id a already exists");
  });

  it("drops a group whose last panel is removed or moved out", () => {
    const api = createFakeLayoutApi({
      groups: [
        { id: "g1", rect: rect(0, 0), panels: [filePanel("a")] },
        { id: "g2", rect: rect(100, 0), panels: [filePanel("b")] },
        { id: "g3", rect: rect(200, 0), panels: [filePanel("c")] },
      ],
    });

    api.removePanel("a");
    api.movePanelToGroup({ panelId: "b", groupId: "g3" });

    expect(api.getGroups().map((g) => g.id)).toEqual(["g3"]);
  });
});
