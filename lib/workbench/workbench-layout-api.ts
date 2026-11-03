import type { WorkbenchTabParams } from "@/lib/workbench/tab-descriptors";

export interface WorkbenchPanelRef {
  id: string;
  groupId: string;
  params: WorkbenchTabParams;
}

export interface WorkbenchGroupRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface WorkbenchGroupRef {
  id: string;
  panelIds: string[];
  activePanelId: string | null;
  rect: WorkbenchGroupRect;
}

export type WorkbenchSplitDirection = "right" | "below" | "left";

export interface WorkbenchNewPanelInput {
  id: string;
  params: WorkbenchTabParams;
  title: string;
}

export interface WorkbenchLayoutApi {
  getGroups(): WorkbenchGroupRef[];
  getActiveGroupId(): string | null;
  getActivePanelId(): string | null;
  getPanels(): WorkbenchPanelRef[];
  getPanel(id: string): WorkbenchPanelRef | null;
  addPanel(input: WorkbenchNewPanelInput & { groupId: string | null }): void;
  removePanel(id: string): void;
  activatePanel(id: string): void;
  activateGroup(groupId: string): void;
  addGroupWithPanel(input: {
    referenceGroupId: string;
    direction: WorkbenchSplitDirection;
    panel: WorkbenchNewPanelInput;
  }): void;
  movePanelToGroup(input: { panelId: string; groupId: string }): void;
  // Must keep the same panel instance (dockview: panel.api.moveTo), never remove + re-add.
  movePanelToNewGroup(input: {
    panelId: string;
    referenceGroupId: string;
    direction: WorkbenchSplitDirection;
  }): void;
  updatePanelParams(
    id: string,
    params: WorkbenchTabParams,
    title: string,
  ): void;
}
