import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LspSessionDriver } from "@/components/lsp/lsp-session-driver";
import { useLspDialogStore } from "@/stores/lsp-dialog-store";

vi.mock("@/hooks/use-settings", () => ({
  useLspEnabledSetting: () => ({ isLspEnabled: true }),
}));
vi.mock("@/lib/lsp/client/lsp-session-registry", () => ({
  getLspSessionConnector: () => null,
  getRegisteredLspMonaco: () => null,
  getActiveLspWorkspaceRoot: () => "/Workspace",
}));
vi.mock("@/lib/lsp/client/session-controller", () => ({
  createLspSessionController: () => ({ update: vi.fn(), dispose: vi.fn() }),
}));

afterEach(() => {
  act(() => useLspDialogStore.getState().close(null));
  cleanup();
});

describe("LSP session driver dialog", () => {
  it("renders exactly one move dialog when a target is requested", () => {
    render(<LspSessionDriver />);
    act(() => {
      void useLspDialogStore.getState().open();
    });
    expect(
      screen.getAllByRole("dialog", { name: "Move to file" }),
    ).toHaveLength(1);
  });
});
