import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LspSessionControllerDeps } from "@/lib/lsp/client/session-controller";
import { mocks } from "../../lib/lsp/lsp-session-mocks";
import {
  createSessionFixture,
  FakeSessionWebSocket,
} from "../../lib/lsp/lsp-session-fixture";

const controller = vi.hoisted(() => ({
  deps: null as LspSessionControllerDeps | null,
}));
vi.mock("@/hooks/use-settings", () => ({
  useLspEnabledSetting: () => ({ isLspEnabled: true, isLoading: false }),
}));
vi.mock("@/components/lsp/move-to-file-dialog", () => ({
  MoveToFileDialog: () => null,
}));
vi.mock("@/lib/lsp/client/session-controller", () => ({
  createLspSessionController: (deps: LspSessionControllerDeps) => {
    controller.deps = deps;
    return { update: vi.fn(), dispose: vi.fn() };
  },
}));

const connectOptions = {
  wsUrl: "ws://localhost:7601",
  workspaceId: "workspace",
  workspaceRoot: "/Workspace",
  onUnexpectedClose: vi.fn(),
};

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  controller.deps = null;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function renderDriverAndGetControllerDeps(): Promise<LspSessionControllerDeps> {
  const { LspSessionDriver } =
    await import("@/components/lsp/lsp-session-driver");
  render(<LspSessionDriver />);
  if (controller.deps === null) throw new Error("controller was not created");
  return controller.deps;
}

describe("LSP session driver connect delegation", () => {
  it("rejects the connect attempt when no session connector is registered", async () => {
    const deps = await renderDriverAndGetControllerDeps();
    await expect(deps.connect(connectOptions)).rejects.toThrow(
      "LSP session runtime is not loaded",
    );
  });

  it("connects through the connector registered by registerLspMonacoInstance", async () => {
    FakeSessionWebSocket.instances = [];
    FakeSessionWebSocket.isAutoOpen = true;
    vi.stubGlobal("WebSocket", FakeSessionWebSocket);
    const fixture = createSessionFixture();
    mocks.start.mockResolvedValue();
    mocks.dispose.mockResolvedValue();
    mocks.toSocket.mockImplementation((socket) => socket);
    mocks.onNotification.mockReturnValue({ dispose: mocks.editDispose });
    mocks.registerOverlay.mockReturnValue({ dispose: mocks.overlayDispose });
    mocks.dirtySync.mockReturnValue({ dispose: mocks.dirtyDispose });
    const deps = await renderDriverAndGetControllerDeps();
    const session = await import("@/lib/lsp/client/lsp-session");
    session.registerLspMonacoInstance(fixture.monaco);

    const handle = await deps.connect(connectOptions);

    expect(handle.workspaceId).toBe("workspace");
    expect(FakeSessionWebSocket.instances).toHaveLength(1);
    expect(mocks.start).toHaveBeenCalledOnce();
    expect(mocks.bootstrap).not.toHaveBeenCalled();
    expect(session.getActiveLspWorkspaceRoot()).toBe("/Workspace");
    await handle.dispose();
    expect(session.getActiveLspWorkspaceRoot()).toBeNull();
  });
});
