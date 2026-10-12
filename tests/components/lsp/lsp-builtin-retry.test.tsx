import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LspSessionDriver } from "@/components/lsp/lsp-session-driver";
import { createSessionFixture } from "../../lib/lsp/lsp-session-fixture";
import { trackBuiltinTs } from "@/lib/lsp/client/builtin-typescript";
import { useLspStore } from "@/stores/lsp-store";

const mocks = vi.hoisted(() => ({ getMonaco: vi.fn() }));
vi.mock("@/hooks/use-settings", () => ({
  useLspEnabledSetting: () => ({ isLspEnabled: true, isLoading: false }),
}));
vi.mock("@/components/lsp/move-to-file-dialog", () => ({
  MoveToFileDialog: () => null,
}));
vi.mock("@/lib/lsp/client/lsp-session-registry", () => ({
  getLspSessionConnector: () => null,
  getRegisteredLspMonaco: mocks.getMonaco,
}));
vi.mock("@/lib/lsp/client/session-controller", () => ({
  createLspSessionController: () => ({ update: vi.fn(), dispose: vi.fn() }),
}));
beforeEach(() => useLspStore.setState({ status: "error" }));
afterEach(cleanup);

describe("LSP retry suppression", () => {
  it("holds restored providers synchronously when a new attempt enters starting", () => {
    const fixture = createSessionFixture();
    trackBuiltinTs(fixture.monaco);
    fixture.languages.registerInlayHintsProvider("typescript", {});
    mocks.getMonaco.mockReturnValue(fixture.monaco);
    render(<LspSessionDriver />);
    act(() => {
      useLspStore.getState().setStatus("starting");
      expect(fixture.registrations.size).toBe(0);
      fixture.languages.registerHoverProvider("javascript", {});
      expect(fixture.registrations.size).toBe(0);
    });
  });
});
