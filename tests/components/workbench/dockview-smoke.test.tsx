import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  DockviewReact,
  type DockviewApi,
  type DockviewReadyEvent,
} from "dockview-react";
import { DEVHUB_DOCKVIEW_THEME } from "@/components/workbench/dockview-theme";

function Probe() {
  return <div data-testid="probe-body">Probe</div>;
}

describe("DockviewReact smoke", () => {
  it("fires onReady and adds one panel when rendered with the devhub theme", () => {
    const readyApis: DockviewApi[] = [];
    const handleReady = (event: DockviewReadyEvent) => {
      readyApis.push(event.api);
      event.api.addPanel({ id: "p1", component: "probe", title: "Probe" });
    };

    render(
      <div style={{ width: 800, height: 600 }}>
        <DockviewReact
          components={{ probe: Probe }}
          theme={DEVHUB_DOCKVIEW_THEME}
          onReady={handleReady}
        />
      </div>,
    );

    expect(readyApis).toHaveLength(1);
    expect(readyApis[0]?.panels.length).toBe(1);
    expect(screen.getByTestId("probe-body")).toHaveTextContent("Probe");
  });
});
