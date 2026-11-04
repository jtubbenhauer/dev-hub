import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";

import {
  LayoutSlotHost,
  LayoutSlotPortal,
  LayoutSlotsProvider,
} from "@/components/layout/layout-slots";

function getSlotHost(slot: string): HTMLElement {
  const host = document.querySelector(`[data-layout-slot="${slot}"]`);
  if (!(host instanceof HTMLElement)) {
    throw new Error(`missing slot host ${slot}`);
  }
  return host;
}

describe("LayoutSlotPortal", () => {
  it("renders its children inside the matching slot host", () => {
    // Given a provider with both slot hosts
    render(
      <LayoutSlotsProvider>
        <LayoutSlotHost slot="header-trailing" />
        <LayoutSlotHost slot="right-panel" />
        <LayoutSlotPortal slot="right-panel">
          <div data-testid="panel-content">panel</div>
        </LayoutSlotPortal>
        <LayoutSlotPortal slot="header-trailing">
          <div data-testid="trailing-content">trailing</div>
        </LayoutSlotPortal>
      </LayoutSlotsProvider>,
    );

    // Then each portal lands in its own host
    expect(
      within(getSlotHost("right-panel")).getByTestId("panel-content"),
    ).toHaveTextContent("panel");
    expect(
      within(getSlotHost("header-trailing")).getByTestId("trailing-content"),
    ).toHaveTextContent("trailing");
  });

  it("renders nothing while its slot host is absent", () => {
    // Given a provider without a right-panel host
    render(
      <LayoutSlotsProvider>
        <LayoutSlotPortal slot="right-panel">
          <div data-testid="panel-content">panel</div>
        </LayoutSlotPortal>
      </LayoutSlotsProvider>,
    );

    // Then the portal content is not in the document
    expect(screen.queryByTestId("panel-content")).not.toBeInTheDocument();
  });

  it("renders nothing without a provider", () => {
    // Given no provider at all
    render(
      <LayoutSlotPortal slot="header-trailing">
        <div data-testid="trailing-content">trailing</div>
      </LayoutSlotPortal>,
    );

    // Then the portal content is not in the document
    expect(screen.queryByTestId("trailing-content")).not.toBeInTheDocument();
  });
});
