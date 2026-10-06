import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LspStatusToggle } from "@/components/editor/lsp-status-toggle";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { LspClientStatus } from "@/lib/lsp/types";
import { useLspStore } from "@/stores/lsp-store";

const { mutateMock, lspSetting } = vi.hoisted(() => ({
  mutateMock: vi.fn(),
  lspSetting: { isLspEnabled: false },
}));

vi.mock("@/hooks/use-settings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/use-settings")>();
  return {
    ...actual,
    useLspEnabledSetting: () => ({
      isLspEnabled: lspSetting.isLspEnabled,
      isLoading: false,
    }),
    useSettingsMutation: () => ({ mutate: mutateMock, isPending: false }),
  };
});

const initialLspState = useLspStore.getState();

function renderToggle() {
  return render(
    <TooltipProvider>
      <LspStatusToggle />
    </TooltipProvider>,
  );
}

function setStatus(status: LspClientStatus, errorMessage?: string) {
  act(() => useLspStore.getState().setStatus(status, errorMessage));
}

beforeEach(() => {
  useLspStore.setState(initialLspState, true);
  mutateMock.mockClear();
  lspSetting.isLspEnabled = false;
});

describe("LspStatusToggle", () => {
  const cases: readonly [LspClientStatus, string, string][] = [
    ["disabled", "bg-muted-foreground/40", "Off — click to enable"],
    ["unavailable", "bg-muted-foreground/40", "Needs a local workspace"],
    ["waiting-for-editor", "bg-yellow-500", "Waiting for an editor"],
    ["starting", "bg-yellow-500", "Starting…"],
    ["connecting", "bg-yellow-500", "Connecting…"],
    ["connected", "bg-green-500", "Connected"],
    ["busy", "bg-orange-500", "In use in another tab"],
    ["error", "bg-destructive", "Error: spawn failed"],
  ];

  it.each(cases)(
    "renders the %s status with its dot colour and label",
    (status, dotClass, tooltipText) => {
      renderToggle();
      setStatus(status, status === "error" ? "spawn failed" : undefined);

      const toggle = screen.getByTestId("lsp-status-toggle");
      expect(toggle).toHaveAttribute("data-lsp-status", status);
      expect(toggle).toHaveTextContent("TS");
      expect(toggle).toHaveAccessibleName(
        `TypeScript language server: ${tooltipText}`,
      );
      expect(screen.getByTestId("lsp-status-dot")).toHaveClass(dotClass);
    },
  );

  it("shows the tooltip text when focused", async () => {
    renderToggle();
    setStatus("busy");

    await userEvent.tab();

    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "In use in another tab",
    );
  });

  it("enables the setting when clicked while disabled", async () => {
    renderToggle();

    await userEvent.click(screen.getByTestId("lsp-status-toggle"));

    expect(mutateMock).toHaveBeenCalledWith({
      key: "lsp-enabled",
      value: true,
    });
  });

  it("disables the setting when clicked while enabled", async () => {
    lspSetting.isLspEnabled = true;
    renderToggle();
    setStatus("connected");

    await userEvent.click(screen.getByTestId("lsp-status-toggle"));

    expect(mutateMock).toHaveBeenCalledWith({
      key: "lsp-enabled",
      value: false,
    });
  });

  it.each<LspClientStatus>([
    "disabled",
    "unavailable",
    "waiting-for-editor",
    "starting",
    "connecting",
    "connected",
    "busy",
  ])("hides the retry button in the %s status", (status) => {
    renderToggle();
    setStatus(status);

    expect(screen.queryByTestId("lsp-retry")).not.toBeInTheDocument();
  });

  it("requests a retry from the error state", async () => {
    renderToggle();
    setStatus("error", "spawn failed");

    await userEvent.click(
      screen.getByRole("button", { name: "Retry TypeScript language server" }),
    );

    expect(useLspStore.getState().retryNonce).toBe(1);
    expect(mutateMock).not.toHaveBeenCalled();
  });
});
