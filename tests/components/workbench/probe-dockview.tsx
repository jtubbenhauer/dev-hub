import { act, render } from "@testing-library/react";
import {
  DockviewReact,
  type DockviewApi,
  type IDockviewPanelProps,
} from "dockview-react";

import { createDockviewLayoutApi } from "@/components/workbench/dockview-layout-api";
import type { WorkbenchLayoutApi } from "@/lib/workbench/workbench-layout-api";

function ProbePanel({ api }: IDockviewPanelProps) {
  return <div data-testid={`probe-${api.id}`}>{api.component}</div>;
}

const PROBE_COMPONENTS = {
  terminal: ProbePanel,
  file: ProbePanel,
  chat: ProbePanel,
  diff: ProbePanel,
  launcher: ProbePanel,
};

// A real dockview instance in jsdom, with one probe component per tab kind.
// `onReady` runs inside dockview's own ready callback, like the workbench restore.
export function renderProbeDockview(
  onReady?: (api: DockviewApi) => void,
): DockviewApi {
  const readyApis: DockviewApi[] = [];
  render(
    <div style={{ width: 800, height: 600 }}>
      <DockviewReact
        components={PROBE_COMPONENTS}
        onReady={(event) => {
          onReady?.(event.api);
          readyApis.push(event.api);
        }}
      />
    </div>,
  );
  const [api] = readyApis;
  if (!api) throw new Error("DockviewReact never fired onReady");
  return api;
}

// Every mutation adds or removes dockview's React portals, so it runs in act().
export function createActDockviewLayoutApi(
  api: DockviewApi,
): WorkbenchLayoutApi {
  const layoutApi = createDockviewLayoutApi(api);
  return {
    ...layoutApi,
    addPanel: (input) => act(() => layoutApi.addPanel(input)),
    removePanel: (id) => act(() => layoutApi.removePanel(id)),
    activatePanel: (id) => act(() => layoutApi.activatePanel(id)),
    activateGroup: (groupId) => act(() => layoutApi.activateGroup(groupId)),
    addGroupWithPanel: (input) => act(() => layoutApi.addGroupWithPanel(input)),
    movePanelToGroup: (input) => act(() => layoutApi.movePanelToGroup(input)),
    movePanelToNewGroup: (input) =>
      act(() => layoutApi.movePanelToNewGroup(input)),
    updatePanelParams: (id, params, title) =>
      act(() => layoutApi.updatePanelParams(id, params, title)),
  };
}
