import type {
  DockviewApi,
  DockviewGroupPanel,
  IDockviewPanel,
  Position,
} from "dockview-react";
import type { RestoredPanelSource } from "@/components/workbench/workbench-layout-restore";
import { isWorkbenchTabParams } from "@/lib/workbench/tab-descriptors";
import type {
  WorkbenchGroupRef,
  WorkbenchLayoutApi,
  WorkbenchNewPanelInput,
  WorkbenchPanelRef,
  WorkbenchSplitDirection,
} from "@/lib/workbench/workbench-layout-api";

function assertNever(value: never): never {
  throw new Error(`Unhandled split direction: ${String(value)}`);
}

function toDockviewPosition(direction: WorkbenchSplitDirection): Position {
  switch (direction) {
    case "right":
      return "right";
    case "left":
      return "left";
    case "below":
      return "bottom";
    default:
      return assertNever(direction);
  }
}

// dockview params are untrusted (restored layouts); only valid tab params pass.
function toPanelRef(panel: IDockviewPanel): WorkbenchPanelRef | null {
  const { params } = panel;
  if (!isWorkbenchTabParams(params)) return null;
  return { id: panel.id, groupId: panel.group.id, params };
}

function toGroupRef(group: DockviewGroupPanel): WorkbenchGroupRef {
  const { left, top, width, height } = group.element.getBoundingClientRect();
  return {
    id: group.id,
    panelIds: group.panels.map((panel) => panel.id),
    activePanelId: group.activePanel?.id ?? null,
    rect: { left, top, width, height },
  };
}

function findGroup(
  api: DockviewApi,
  groupId: string,
): DockviewGroupPanel | undefined {
  return api.groups.find((group) => group.id === groupId);
}

function addDockviewPanel(
  api: DockviewApi,
  panel: WorkbenchNewPanelInput,
  groupId: string | null,
): void {
  api.addPanel({
    id: panel.id,
    component: panel.params.kind,
    params: panel.params,
    title: panel.title,
    position: groupId === null ? undefined : { referenceGroup: groupId },
    renderer: "always",
  });
}

function removeDockviewPanel(api: DockviewApi, panelId: string): void {
  const panel = api.getPanel(panelId);
  if (panel) api.removePanel(panel);
}

export function createDockviewLayoutApi(api: DockviewApi): WorkbenchLayoutApi {
  return {
    getGroups: () => api.groups.map(toGroupRef),
    getActiveGroupId: () => api.activeGroup?.id ?? null,
    getActivePanelId: () => api.activePanel?.id ?? null,
    getPanels: () =>
      api.panels.flatMap((panel) => {
        const panelRef = toPanelRef(panel);
        return panelRef ? [panelRef] : [];
      }),
    getPanel: (id) => {
      const panel = api.getPanel(id);
      return panel ? toPanelRef(panel) : null;
    },
    addPanel: ({ groupId, ...panel }) => addDockviewPanel(api, panel, groupId),
    removePanel: (id) => removeDockviewPanel(api, id),
    activatePanel: (id) => api.getPanel(id)?.api.setActive(),
    activateGroup: (groupId) => findGroup(api, groupId)?.api.setActive(),
    addGroupWithPanel: ({ referenceGroupId, direction, panel }) => {
      const group = api.addGroup({
        referenceGroup: referenceGroupId,
        direction,
      });
      addDockviewPanel(api, panel, group.id);
    },
    movePanelToGroup: ({ panelId, groupId }) => {
      const group = findGroup(api, groupId);
      if (group) api.getPanel(panelId)?.api.moveTo({ group });
    },
    // A group's only panel moved to its own edge is a no-op in dockview 8.8.3.
    movePanelToNewGroup: ({ panelId, referenceGroupId, direction }) => {
      const group = findGroup(api, referenceGroupId);
      if (!group) return;
      api
        .getPanel(panelId)
        ?.api.moveTo({ group, position: toDockviewPosition(direction) });
    },
    updatePanelParams: (id, params, title) => {
      const panel = api.getPanel(id);
      if (!panel) return;
      panel.api.updateParameters(params);
      panel.api.setTitle(title);
    },
  };
}

export function createDockviewRestoredPanelSource(
  api: DockviewApi,
): RestoredPanelSource {
  return {
    getPanels: () =>
      api.panels.map((panel) => ({ id: panel.id, params: panel.params })),
    removePanel: (id) => removeDockviewPanel(api, id),
  };
}
