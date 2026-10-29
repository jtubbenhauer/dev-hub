import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AccessProfilePicker } from "@/components/workspace/access-profile-picker";
import type { ProviderAccessOption } from "@/types";

global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

HTMLElement.prototype.scrollIntoView = vi.fn();
HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
HTMLElement.prototype.releasePointerCapture = vi.fn();

if (typeof window !== "undefined") {
  class MockPointerEvent extends Event {
    button: number;
    ctrlKey: boolean;
    pointerType: string;

    constructor(type: string, props: PointerEventInit) {
      super(type, props);
      this.button = props.button || 0;
      this.ctrlKey = props.ctrlKey || false;
      this.pointerType = props.pointerType || "mouse";
    }
  }
  window.PointerEvent = MockPointerEvent as unknown as typeof PointerEvent;
}

const ACCESS_OPTIONS: ProviderAccessOption[] = [
  {
    id: "dev-ops",
    label: "Dev: logs and function metadata",
    description: "Read-only access to principle-dev logs and functions.",
    isEligible: true,
    isReasonRequired: false,
  },
  {
    id: "prod-data",
    label: "Prod: read Firestore data",
    isEligible: true,
    isReasonRequired: true,
    gate: { ttlHours: 4, isReasonRequired: true },
  },
  {
    id: "prod-ops",
    label: "Prod: logs and function metadata",
    isEligible: false,
    ineligibleReason: "Ask for access to rig-prod@",
    isReasonRequired: false,
  },
  {
    id: "staging-ops",
    label: "Staging: debugging",
    isEligible: true,
    isReasonRequired: true,
  },
];

function renderPicker(
  overrides: Partial<Parameters<typeof AccessProfilePicker>[0]> = {},
) {
  const onProfileChange = vi.fn();
  const onReasonChange = vi.fn();
  render(
    <AccessProfilePicker
      options={ACCESS_OPTIONS}
      isLoading={false}
      selectedProfileId="none"
      onProfileChange={onProfileChange}
      reason=""
      onReasonChange={onReasonChange}
      {...overrides}
    />,
  );
  return { onProfileChange, onReasonChange };
}

describe("AccessProfilePicker", () => {
  it("defaults to no cloud access", () => {
    renderPicker();
    expect(
      screen.getByRole("combobox", { name: /Cloud access/i }),
    ).toHaveTextContent("No cloud access");
  });

  it("lists profiles and disables the ones the developer is not eligible for", async () => {
    const user = userEvent.setup();
    const { onProfileChange } = renderPicker();

    await user.click(screen.getByRole("combobox", { name: /Cloud access/i }));

    expect(
      await screen.findByRole("option", {
        name: /Dev: logs and function metadata/i,
      }),
    ).not.toHaveAttribute("aria-disabled", "true");
    const ineligibleOption = screen.getByRole("option", {
      name: /Prod: logs and function metadata/i,
    });
    expect(ineligibleOption).toHaveAttribute("aria-disabled", "true");
    expect(ineligibleOption).toHaveTextContent("Ask for access to rig-prod@");

    await user.click(
      screen.getByRole("option", { name: /Dev: logs and function metadata/i }),
    );
    expect(onProfileChange).toHaveBeenCalledWith("dev-ops");
  });

  it("shows the profile description once selected", () => {
    renderPicker({ selectedProfileId: "dev-ops" });
    expect(
      screen.getByText("Read-only access to principle-dev logs and functions."),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Reason for access"),
    ).not.toBeInTheDocument();
  });

  it("asks for a reason and shows the time limit for a gated profile", async () => {
    const user = userEvent.setup();
    const { onReasonChange } = renderPicker({ selectedProfileId: "prod-data" });

    expect(
      screen.getByText(/Access expires after 4 hours/i),
    ).toBeInTheDocument();
    await user.type(screen.getByLabelText("Reason for access"), "x");
    expect(onReasonChange).toHaveBeenCalledWith("x");
  });

  it("asks for a reason without a time limit when the profile requires one", async () => {
    const user = userEvent.setup();
    const { onReasonChange } = renderPicker({
      selectedProfileId: "staging-ops",
    });

    expect(screen.queryByText(/Access expires after/i)).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("Reason for access"), "x");
    expect(onReasonChange).toHaveBeenCalledWith("x");
  });

  it("explains that creation still works when profiles fail to load", () => {
    renderPicker({ options: [], loadError: "Access options command failed" });
    expect(
      screen.getByText(
        /Access options command failed\. Workspaces can still be created without cloud access\./,
      ),
    ).toBeInTheDocument();
  });
});
