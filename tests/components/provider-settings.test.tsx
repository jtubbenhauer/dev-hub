import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProviderSettings } from "@/components/settings/provider-settings";

const mockMutate = vi.fn();

vi.mock("@/hooks/use-settings", () => ({
  useWorkspaceProviders: vi.fn(() => ({
    providers: [],
    isLoading: false,
  })),
  useSettingsMutation: vi.fn(() => ({
    mutate: mockMutate,
    isPending: false,
  })),
  SETTINGS_KEYS: {
    WORKSPACE_PROVIDERS: "workspace-providers",
  },
}));

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

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ProviderSettings", () => {
  it("shows Start command field when provider type is auto-suspend", async () => {
    const user = userEvent.setup();
    render(<ProviderSettings />);

    await user.click(screen.getByRole("button", { name: /Add Provider/i }));

    const selectTrigger = screen.getByRole("combobox", {
      name: /Provider Type/i,
    });
    await user.click(selectTrigger);
    await user.click(
      await screen.findByRole("option", { name: /Auto-suspend/i }),
    );

    expect(screen.getByLabelText("Start (optional)")).toBeInTheDocument();
  });

  it("shows Start command field when provider type is custom", async () => {
    const user = userEvent.setup();
    render(<ProviderSettings />);

    await user.click(screen.getByRole("button", { name: /Add Provider/i }));

    const selectTrigger = screen.getByRole("combobox", {
      name: /Provider Type/i,
    });
    await user.click(selectTrigger);
    await user.click(await screen.findByRole("option", { name: /Custom/i }));

    expect(screen.getByLabelText("Start (optional)")).toBeInTheDocument();
  });

  it("hides Start command field when provider type is always-on", async () => {
    const user = userEvent.setup();
    render(<ProviderSettings />);

    await user.click(screen.getByRole("button", { name: /Add Provider/i }));

    const selectTrigger = screen.getByRole("combobox", {
      name: /Provider Type/i,
    });
    await user.click(selectTrigger);
    await user.click(await screen.findByRole("option", { name: /Always-on/i }));

    expect(screen.queryByLabelText("Start (optional)")).not.toBeInTheDocument();
  });

  it.each([
    [
      "saves the access options command when one is entered",
      "{binary} access list --json",
      "{binary} access list --json",
    ],
    ["leaves access options out when the field is blank", "", undefined],
  ])("%s", async (_description, enteredCommand, expectedCommand) => {
    const user = userEvent.setup();
    render(<ProviderSettings />);

    await user.click(screen.getByRole("button", { name: /Add Provider/i }));
    await user.type(screen.getByLabelText("Name"), "rig-cli");
    await user.type(screen.getByLabelText("Binary Path"), "rig-cli");
    if (enteredCommand) {
      await user.type(
        screen.getByLabelText("Access options (optional)"),
        enteredCommand.replaceAll("{", "{{"),
      );
    }
    const addButtons = screen.getAllByRole("button", { name: /Add Provider/i });
    await user.click(addButtons[addButtons.length - 1]);

    expect(mockMutate).toHaveBeenCalledTimes(1);
    const [{ value }] = mockMutate.mock.calls[0] as [
      { value: Array<{ commands: Record<string, string> }> },
    ];
    expect(value[0].commands.accessOptions).toBe(expectedCommand);
  });
});
