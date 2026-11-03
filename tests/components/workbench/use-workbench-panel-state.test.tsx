import { describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import {
  DockviewReact,
  type DockviewApi,
  type IDockviewPanelProps,
} from "dockview-react";

import { useWorkbenchPanelState } from "@/components/workbench/use-workbench-panel-state";

function StateProbe({ api, containerApi }: IDockviewPanelProps) {
  const { isVisible, isFocused } = useWorkbenchPanelState(api, containerApi);
  return (
    <output
      aria-label={`state ${api.id}`}
      data-visible={String(isVisible)}
      data-focused={String(isFocused)}
    />
  );
}

function renderTwoGroups(): DockviewApi {
  const readyApis: DockviewApi[] = [];
  render(
    <div style={{ width: 800, height: 600 }}>
      <DockviewReact
        components={{ probe: StateProbe }}
        defaultRenderer="always"
        onReady={(event) => {
          event.api.addPanel({ id: "a", component: "probe" });
          event.api.addPanel({ id: "b", component: "probe" });
          event.api.addPanel({
            id: "c",
            component: "probe",
            position: { referencePanel: "b", direction: "right" },
          });
          readyApis.push(event.api);
        }}
      />
    </div>,
  );
  const [api] = readyApis;
  if (!api) throw new Error("DockviewReact never fired onReady");
  return api;
}

function stateOf(panelId: string) {
  const element = screen.getByLabelText(`state ${panelId}`);
  return {
    isVisible: element.dataset.visible,
    isFocused: element.dataset.focused,
  };
}

describe("useWorkbenchPanelState", () => {
  it("reports the active panel of the active group as visible and focused", () => {
    // When
    renderTwoGroups();

    // Then
    expect(stateOf("c")).toEqual({ isVisible: "true", isFocused: "true" });
  });

  it("reports a background tab as hidden and unfocused", () => {
    // When
    renderTwoGroups();

    // Then
    expect(stateOf("a")).toEqual({ isVisible: "false", isFocused: "false" });
  });

  it("reports the visible tab of an inactive group as visible but unfocused", () => {
    // When
    renderTwoGroups();

    // Then
    expect(stateOf("b")).toEqual({ isVisible: "true", isFocused: "false" });
  });

  it("follows activation to another panel", () => {
    // Given
    const api = renderTwoGroups();

    // When
    act(() => api.getPanel("a")?.api.setActive());

    // Then
    expect(stateOf("a")).toEqual({ isVisible: "true", isFocused: "true" });
    expect(stateOf("b")).toEqual({ isVisible: "false", isFocused: "false" });
    expect(stateOf("c")).toEqual({ isVisible: "true", isFocused: "false" });
  });
});
