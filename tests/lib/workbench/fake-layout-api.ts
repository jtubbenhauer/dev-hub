import type { WorkbenchTabParams } from "@/lib/workbench/tab-descriptors";
import type {
  WorkbenchGroupRect,
  WorkbenchGroupRef,
  WorkbenchLayoutApi,
  WorkbenchNewPanelInput,
  WorkbenchPanelRef,
  WorkbenchSplitDirection,
} from "@/lib/workbench/workbench-layout-api";

export interface FakePanelSeed {
  id: string;
  params: WorkbenchTabParams;
  title?: string;
}

export interface FakeGroupSeed {
  id: string;
  rect: WorkbenchGroupRect;
  panels: FakePanelSeed[];
  activePanelId?: string | null;
}

export interface FakeLayoutSeed {
  groups: FakeGroupSeed[];
  activeGroupId?: string | null;
}

export type FakeLayoutMutation = keyof WorkbenchLayoutApi;

export interface FakeLayoutApi extends WorkbenchLayoutApi {
  readonly mutations: FakeLayoutMutation[];
  getTitle(id: string): string | null;
}

interface FakeGroupState {
  id: string;
  rect: WorkbenchGroupRect;
  panelIds: string[];
  activePanelId: string | null;
}

interface FakePanelState {
  id: string;
  groupId: string;
  params: WorkbenchTabParams;
  title: string;
}

const FULL_RECT: WorkbenchGroupRect = {
  left: 0,
  top: 0,
  width: 1000,
  height: 1000,
};

function splitRect(
  reference: WorkbenchGroupRect,
  direction: WorkbenchSplitDirection,
): { reference: WorkbenchGroupRect; created: WorkbenchGroupRect } {
  const halfWidth = reference.width / 2;
  const halfHeight = reference.height / 2;
  switch (direction) {
    case "right":
      return {
        reference: { ...reference, width: halfWidth },
        created: {
          ...reference,
          left: reference.left + halfWidth,
          width: halfWidth,
        },
      };
    case "left":
      return {
        reference: {
          ...reference,
          left: reference.left + halfWidth,
          width: halfWidth,
        },
        created: { ...reference, width: halfWidth },
      };
    case "below":
      return {
        reference: { ...reference, height: halfHeight },
        created: {
          ...reference,
          top: reference.top + halfHeight,
          height: halfHeight,
        },
      };
  }
}

export function createFakeLayoutApi(
  seed: FakeLayoutSeed = { groups: [] },
): FakeLayoutApi {
  const groups: FakeGroupState[] = [];
  const panels = new Map<string, FakePanelState>();
  const mutations: FakeLayoutMutation[] = [];
  let activeGroupId: string | null = null;
  let groupCounter = 0;

  function nextGroupId(): string {
    groupCounter += 1;
    return `fake-group-${groupCounter}`;
  }

  function requireGroup(groupId: string): FakeGroupState {
    const group = groups.find((candidate) => candidate.id === groupId);
    if (!group) throw new Error(`group with id ${groupId} does not exist`);
    return group;
  }

  function requirePanel(panelId: string): FakePanelState {
    const panel = panels.get(panelId);
    if (!panel) throw new Error(`panel with id ${panelId} does not exist`);
    return panel;
  }

  function assertPanelIdIsFree(panelId: string): void {
    if (panels.has(panelId)) {
      throw new Error(`panel with id ${panelId} already exists`);
    }
  }

  function detachPanelFromGroup(panel: FakePanelState): void {
    const group = requireGroup(panel.groupId);
    const index = group.panelIds.indexOf(panel.id);
    group.panelIds.splice(index, 1);
    if (group.activePanelId === panel.id) {
      group.activePanelId =
        group.panelIds[Math.min(index, group.panelIds.length - 1)] ?? null;
    }
    if (group.panelIds.length > 0) return;
    groups.splice(groups.indexOf(group), 1);
    if (activeGroupId === group.id) activeGroupId = groups[0]?.id ?? null;
  }

  function attachPanelToGroup(panel: FakePanelState, group: FakeGroupState) {
    panel.groupId = group.id;
    group.panelIds.push(panel.id);
    group.activePanelId = panel.id;
    activeGroupId = group.id;
  }

  function createGroupBeside(
    referenceGroupId: string,
    direction: WorkbenchSplitDirection,
  ): FakeGroupState {
    const reference = requireGroup(referenceGroupId);
    const rects = splitRect(reference.rect, direction);
    reference.rect = rects.reference;
    const created: FakeGroupState = {
      id: nextGroupId(),
      rect: rects.created,
      panelIds: [],
      activePanelId: null,
    };
    groups.push(created);
    return created;
  }

  function createPanelState(input: WorkbenchNewPanelInput): FakePanelState {
    assertPanelIdIsFree(input.id);
    const panel: FakePanelState = { ...input, groupId: "" };
    panels.set(input.id, panel);
    return panel;
  }

  for (const groupSeed of seed.groups) {
    groups.push({
      id: groupSeed.id,
      rect: { ...groupSeed.rect },
      panelIds: groupSeed.panels.map((panelSeed) => panelSeed.id),
      activePanelId: groupSeed.activePanelId ?? groupSeed.panels[0]?.id ?? null,
    });
    for (const { id, params, title } of groupSeed.panels) {
      createPanelState({ id, params, title: title ?? id }).groupId =
        groupSeed.id;
    }
  }
  activeGroupId = seed.activeGroupId ?? groups[0]?.id ?? null;

  function toPanelRef(panel: FakePanelState): WorkbenchPanelRef {
    return { id: panel.id, groupId: panel.groupId, params: panel.params };
  }

  return {
    mutations,
    getTitle: (id) => panels.get(id)?.title ?? null,
    getGroups: (): WorkbenchGroupRef[] =>
      groups.map((group) => ({
        id: group.id,
        panelIds: [...group.panelIds],
        activePanelId: group.activePanelId,
        rect: { ...group.rect },
      })),
    getActiveGroupId: () => activeGroupId,
    getActivePanelId: () =>
      activeGroupId === null ? null : requireGroup(activeGroupId).activePanelId,
    getPanels: () =>
      groups.flatMap((group) =>
        group.panelIds.map((panelId) => toPanelRef(requirePanel(panelId))),
      ),
    getPanel: (id) => {
      const panel = panels.get(id);
      return panel ? toPanelRef(panel) : null;
    },
    addPanel: ({ groupId, ...panelInput }) => {
      mutations.push("addPanel");
      const panel = createPanelState(panelInput);
      let target: FakeGroupState;
      if (groupId !== null) {
        target = requireGroup(groupId);
      } else if (activeGroupId !== null) {
        target = requireGroup(activeGroupId);
      } else {
        target = {
          id: nextGroupId(),
          rect: { ...FULL_RECT },
          panelIds: [],
          activePanelId: null,
        };
        groups.push(target);
      }
      attachPanelToGroup(panel, target);
    },
    removePanel: (id) => {
      mutations.push("removePanel");
      detachPanelFromGroup(requirePanel(id));
      panels.delete(id);
    },
    activatePanel: (id) => {
      mutations.push("activatePanel");
      const panel = requirePanel(id);
      requireGroup(panel.groupId).activePanelId = id;
      activeGroupId = panel.groupId;
    },
    activateGroup: (groupId) => {
      mutations.push("activateGroup");
      activeGroupId = requireGroup(groupId).id;
    },
    addGroupWithPanel: ({ referenceGroupId, direction, panel: panelInput }) => {
      mutations.push("addGroupWithPanel");
      const panel = createPanelState(panelInput);
      attachPanelToGroup(panel, createGroupBeside(referenceGroupId, direction));
    },
    movePanelToGroup: ({ panelId, groupId }) => {
      mutations.push("movePanelToGroup");
      const panel = requirePanel(panelId);
      const target = requireGroup(groupId);
      detachPanelFromGroup(panel);
      attachPanelToGroup(panel, target);
    },
    movePanelToNewGroup: ({ panelId, referenceGroupId, direction }) => {
      mutations.push("movePanelToNewGroup");
      const panel = requirePanel(panelId);
      const created = createGroupBeside(referenceGroupId, direction);
      detachPanelFromGroup(panel);
      attachPanelToGroup(panel, created);
    },
    updatePanelParams: (id, params, title) => {
      mutations.push("updatePanelParams");
      const panel = requirePanel(id);
      panel.params = params;
      panel.title = title;
    },
  };
}
