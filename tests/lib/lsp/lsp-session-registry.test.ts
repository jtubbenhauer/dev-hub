import { beforeEach, describe, expect, it, vi } from "vitest";
import "./lsp-session-mocks";
import { createSessionFixture } from "./lsp-session-fixture";
import type { LspSessionConnector } from "@/lib/lsp/client/lsp-session-registry";

let registry: typeof import("@/lib/lsp/client/lsp-session-registry");
let lspStore: typeof import("@/stores/lsp-store").useLspStore;

beforeEach(async () => {
  vi.resetModules();
  registry = await import("@/lib/lsp/client/lsp-session-registry");
  lspStore = (await import("@/stores/lsp-store")).useLspStore;
});

describe("LSP session registry", () => {
  it("starts with no Monaco, session or connector registered", () => {
    expect(registry.getRegisteredLspMonaco()).toBeNull();
    expect(registry.getActiveLspSession()).toBeNull();
    expect(registry.getActiveLspWorkspaceRoot()).toBeNull();
    expect(registry.getLspSessionConnector()).toBeNull();
  });

  it("tracks the active session workspace root until it is cleared", () => {
    const session = { workspaceRoot: "/Workspace" };
    registry.setActiveLspSession(session);
    expect(registry.getActiveLspSession()).toBe(session);
    expect(registry.getActiveLspWorkspaceRoot()).toBe("/Workspace");
    registry.setActiveLspSession(null);
    expect(registry.getActiveLspWorkspaceRoot()).toBeNull();
  });

  it("returns the most recently registered connector", () => {
    const firstConnector = vi.fn<LspSessionConnector>();
    const secondConnector = vi.fn<LspSessionConnector>();
    registry.registerLspSessionConnector(firstConnector);
    registry.registerLspSessionConnector(secondConnector);
    expect(registry.getLspSessionConnector()).toBe(secondConnector);
  });

  it("registers connectLspSession before Monaco is marked registered", async () => {
    const session = await import("@/lib/lsp/client/lsp-session");
    const fixture = createSessionFixture();
    const connectorsSeenOnRegistration: unknown[] = [];
    const unsubscribe = lspStore.subscribe((state, previous) => {
      if (state.isMonacoRegistered && !previous.isMonacoRegistered) {
        connectorsSeenOnRegistration.push(registry.getLspSessionConnector());
      }
    });
    session.registerLspMonacoInstance(fixture.monaco);
    unsubscribe();
    expect(connectorsSeenOnRegistration).toEqual([session.connectLspSession]);
    expect(registry.getRegisteredLspMonaco()).toBe(fixture.monaco);
  });

  it("re-exports the registry readers from the session module", async () => {
    const session = await import("@/lib/lsp/client/lsp-session");
    expect(session.getRegisteredLspMonaco).toBe(
      registry.getRegisteredLspMonaco,
    );
    expect(session.getActiveLspWorkspaceRoot).toBe(
      registry.getActiveLspWorkspaceRoot,
    );
  });
});
