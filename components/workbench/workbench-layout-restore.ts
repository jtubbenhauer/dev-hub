import {
  isWorkbenchTabParams,
  type WorkbenchTabParams,
} from "@/lib/workbench/tab-descriptors";
import { openOrFocusTab } from "@/lib/workbench/workbench-commands";
import type { WorkbenchLayoutApi } from "@/lib/workbench/workbench-layout-api";

// A restored panel's params come from persisted storage, so they are untrusted.
export interface RestoredPanelSnapshot {
  readonly id: string;
  readonly params: unknown;
}

export interface RestoredPanelSource {
  getPanels(): readonly RestoredPanelSnapshot[];
  removePanel(id: string): void;
}

function belongsToWorkspace(params: unknown, workspaceId: string): boolean {
  return isWorkbenchTabParams(params) && params.workspaceId === workspaceId;
}

export function sanitizeRestoredPanels(
  source: RestoredPanelSource,
  workspaceId: string,
): string[] {
  const removedIds = source
    .getPanels()
    .filter((panel) => !belongsToWorkspace(panel.params, workspaceId))
    .map((panel) => panel.id);
  for (const panelId of removedIds) source.removePanel(panelId);
  return removedIds;
}

export function ensureDefaultPanel(
  layoutApi: WorkbenchLayoutApi,
  params: WorkbenchTabParams,
  title: string,
): string | null {
  if (layoutApi.getPanels().length > 0) return null;
  return openOrFocusTab(layoutApi, params, title);
}

// Mobile shows a single group, so a restored split is folded into the first group.
export function collapseToSingleGroup(layoutApi: WorkbenchLayoutApi): void {
  const [firstGroup, ...otherGroups] = layoutApi.getGroups();
  if (!firstGroup || otherGroups.length === 0) return;
  const activePanelId = layoutApi.getActivePanelId();
  for (const group of otherGroups) {
    for (const panelId of group.panelIds) {
      layoutApi.movePanelToGroup({ panelId, groupId: firstGroup.id });
    }
  }
  if (activePanelId !== null) layoutApi.activatePanel(activePanelId);
}
