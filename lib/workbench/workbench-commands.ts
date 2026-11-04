import {
  createPanelId,
  tabResourceKey,
  type WorkbenchTabParams,
} from "@/lib/workbench/tab-descriptors";
import { pickAdjacentGroup } from "@/lib/workbench/workbench-group-geometry";
import type {
  WorkbenchGroupRef,
  WorkbenchLayoutApi,
  WorkbenchPanelRef,
} from "@/lib/workbench/workbench-layout-api";
import type { WorkbenchGroupDirection } from "@/lib/workbench/workbench-shortcuts";

export { pickAdjacentGroup };

export const LAUNCHER_TAB_TITLE = "New tab";

const LAST_TAB_NUMBER = 9;

function assertNever(value: never): never {
  throw new Error(`Unhandled workbench variant: ${String(value)}`);
}

function getActiveGroup(api: WorkbenchLayoutApi): WorkbenchGroupRef | null {
  const activeGroupId = api.getActiveGroupId();
  if (activeGroupId === null) return null;
  return api.getGroups().find((group) => group.id === activeGroupId) ?? null;
}

export function getActivePanel(
  api: WorkbenchLayoutApi,
): WorkbenchPanelRef | null {
  const activePanelId = api.getActivePanelId();
  return activePanelId === null ? null : api.getPanel(activePanelId);
}

// A launcher or a not-yet-created chat is never "the same resource" as another tab.
function hasSharedResource(params: WorkbenchTabParams): boolean {
  if (params.kind === "launcher") return false;
  return !(params.kind === "chat" && params.sessionId === null);
}

export function findPanelByResource(
  api: WorkbenchLayoutApi,
  params: WorkbenchTabParams,
): WorkbenchPanelRef | null {
  if (!hasSharedResource(params)) return null;
  const requestedKey = tabResourceKey(params, "");
  return (
    api
      .getPanels()
      .find(
        (panel) => tabResourceKey(panel.params, panel.id) === requestedKey,
      ) ?? null
  );
}

function findLoneLauncherId(
  api: WorkbenchLayoutApi,
  group: WorkbenchGroupRef | undefined,
): string | null {
  if (!group || group.panelIds.length !== 1) return null;
  const onlyPanelId = group.panelIds[0];
  return api.getPanel(onlyPanelId)?.params.kind === "launcher"
    ? onlyPanelId
    : null;
}

export function openOrFocusTab(
  api: WorkbenchLayoutApi,
  params: WorkbenchTabParams,
  title: string,
  options?: { groupId?: string | null },
): string {
  const existingPanel = findPanelByResource(api, params);
  if (existingPanel) {
    api.activatePanel(existingPanel.id);
    return existingPanel.id;
  }
  const targetGroupId = options?.groupId ?? api.getActiveGroupId();
  const targetGroup = api
    .getGroups()
    .find((group) => group.id === targetGroupId);
  const loneLauncherId =
    params.kind === "launcher" ? null : findLoneLauncherId(api, targetGroup);
  const panelId = createPanelId();
  api.addPanel({ id: panelId, params, title, groupId: targetGroupId });
  // Remove after the add so the group is never empty (an empty group is dropped).
  if (loneLauncherId !== null) api.removePanel(loneLauncherId);
  return panelId;
}

export function cycleTab(
  api: WorkbenchLayoutApi,
  direction: "next" | "previous",
): string | null {
  const activeGroup = getActiveGroup(api);
  if (!activeGroup || activeGroup.panelIds.length === 0) return null;
  const { panelIds, activePanelId } = activeGroup;
  const step = direction === "next" ? 1 : -1;
  const activeIndex = panelIds.findIndex((id) => id === activePanelId);
  const fromIndex = activeIndex === -1 && step === -1 ? 0 : activeIndex;
  const nextIndex = (fromIndex + step + panelIds.length) % panelIds.length;
  const nextPanelId = panelIds[nextIndex];
  api.activatePanel(nextPanelId);
  return nextPanelId;
}

export function focusTabNumber(
  api: WorkbenchLayoutApi,
  tabNumber: number,
): string | null {
  if (!Number.isInteger(tabNumber)) return null;
  if (tabNumber < 1 || tabNumber > LAST_TAB_NUMBER) return null;
  const activeGroup = getActiveGroup(api);
  if (!activeGroup) return null;
  const { panelIds } = activeGroup;
  const targetPanelId =
    tabNumber === LAST_TAB_NUMBER ? panelIds.at(-1) : panelIds[tabNumber - 1];
  if (targetPanelId === undefined) return null;
  api.activatePanel(targetPanelId);
  return targetPanelId;
}

function findGroupWorkspaceId(
  api: WorkbenchLayoutApi,
  group: WorkbenchGroupRef,
): string | null {
  const panelId = group.activePanelId ?? group.panelIds[0];
  if (panelId === undefined) return null;
  return api.getPanel(panelId)?.params.workspaceId ?? null;
}

export function splitActiveGroup(
  api: WorkbenchLayoutApi,
  direction: "right" | "below",
): string | null {
  const activeGroup = getActiveGroup(api);
  if (!activeGroup) return null;
  const workspaceId = findGroupWorkspaceId(api, activeGroup);
  if (workspaceId === null) return null;
  const launcherId = createPanelId();
  api.addGroupWithPanel({
    referenceGroupId: activeGroup.id,
    direction,
    panel: {
      id: launcherId,
      params: { kind: "launcher", workspaceId },
      title: LAUNCHER_TAB_TITLE,
    },
  });
  api.activatePanel(launcherId);
  return launcherId;
}

export function focusAdjacentGroup(
  api: WorkbenchLayoutApi,
  direction: WorkbenchGroupDirection,
): string | null {
  const adjacentGroup = pickAdjacentGroup(
    api.getGroups(),
    api.getActiveGroupId(),
    direction,
  );
  if (!adjacentGroup) return null;
  api.activateGroup(adjacentGroup.id);
  return adjacentGroup.id;
}

// Returns the moved tab, or null when nothing moved.
export function moveActivePanelToAdjacentGroup(
  api: WorkbenchLayoutApi,
  direction: "left" | "right",
): string | null {
  const activeGroup = getActiveGroup(api);
  const activePanelId = activeGroup?.activePanelId ?? null;
  if (!activeGroup || activePanelId === null) return null;
  const adjacentGroup = pickAdjacentGroup(
    api.getGroups(),
    activeGroup.id,
    direction,
  );
  if (adjacentGroup) {
    const loneLauncherId = findLoneLauncherId(api, adjacentGroup);
    api.movePanelToGroup({ panelId: activePanelId, groupId: adjacentGroup.id });
    // The moved tab replaces the placeholder, as openOrFocusTab does.
    if (loneLauncherId !== null) api.removePanel(loneLauncherId);
    return activePanelId;
  }
  // A lone panel moved beside its own group would just recreate the same layout.
  if (direction === "left" || activeGroup.panelIds.length < 2) return null;
  api.movePanelToNewGroup({
    panelId: activePanelId,
    referenceGroupId: activeGroup.id,
    direction: "right",
  });
  return activePanelId;
}

export type ChatTargetResolution =
  | { action: "focus"; panelId: string }
  | { action: "retarget"; panelId: string }
  | { action: "open" };

export function resolveChatTarget(
  panels: readonly WorkbenchPanelRef[],
  target: { sessionId: string; panelId: string | null },
): ChatTargetResolution {
  const panelShowingSession = panels.find(
    (panel) =>
      panel.params.kind === "chat" &&
      panel.params.sessionId === target.sessionId,
  );
  if (panelShowingSession) {
    return { action: "focus", panelId: panelShowingSession.id };
  }
  const requestingPanel = panels.find((panel) => panel.id === target.panelId);
  if (requestingPanel && requestingPanel.params.kind === "chat") {
    return { action: "retarget", panelId: requestingPanel.id };
  }
  return { action: "open" };
}

export function applyChatTarget(
  api: WorkbenchLayoutApi,
  target: {
    workspaceId: string;
    sessionId: string;
    panelId: string | null;
    shouldActivate?: boolean;
  },
  title: string,
): string {
  const params: WorkbenchTabParams = {
    kind: "chat",
    workspaceId: target.workspaceId,
    sessionId: target.sessionId,
  };
  const resolution = resolveChatTarget(api.getPanels(), target);
  switch (resolution.action) {
    case "focus":
      api.activatePanel(resolution.panelId);
      return resolution.panelId;
    case "retarget":
      api.updatePanelParams(resolution.panelId, params, title);
      // Only an explicit ask activates: a background tab finishing
      // createSession must not steal focus.
      if (target.shouldActivate === true) {
        api.activatePanel(resolution.panelId);
      }
      return resolution.panelId;
    case "open":
      return openOrFocusTab(api, params, title);
    default:
      return assertNever(resolution);
  }
}
