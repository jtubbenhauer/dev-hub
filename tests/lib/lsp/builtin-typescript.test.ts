import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createSessionFixture } from "./lsp-session-fixture";
import { createLspSessionController } from "@/lib/lsp/client/session-controller";

const defaultsGetter = vi.hoisted(() =>
  vi.fn<() => ReturnType<typeof createSessionFixture>["typescript"] | null>(),
);
vi.mock("@/lib/editor/monaco-bootstrap", () => ({
  getStandaloneTypeScriptDefaults: defaultsGetter,
}));

let builtin: typeof import("@/lib/lsp/client/builtin-typescript");
let fixture: ReturnType<typeof createSessionFixture>;
const overlapping = [
  "registerCompletionItemProvider",
  "registerHoverProvider",
  "registerSignatureHelpProvider",
  "registerDefinitionProvider",
  "registerDocumentRangeFormattingEditProvider",
  "registerOnTypeFormattingEditProvider",
  "registerInlayHintsProvider",
  "registerReferenceProvider",
  "registerDocumentHighlightProvider",
  "registerDocumentSymbolProvider",
  "registerRenameProvider",
  "registerCodeActionProvider",
] as const;

describe("built-in TypeScript registrations", () => {
  beforeEach(async () => {
    vi.resetModules();
    builtin = await import("@/lib/lsp/client/builtin-typescript");
    fixture = createSessionFixture();
    defaultsGetter.mockReturnValue(fixture.typescript);
  });
  afterEach(() => vi.restoreAllMocks());

  it("holds providers when suppressed before standalone defaults exist", () => {
    // Given
    defaultsGetter.mockReturnValue(null);
    builtin.suppressBuiltinTypeScriptFeatures(fixture.monaco);
    // When
    fixture.languages.registerHoverProvider("typescript", {});
    // Then
    expect(fixture.registrations.size).toBe(0);
    expect(fixture.editor.onDidChangeMarkers).not.toHaveBeenCalled();
    expect(fixture.editor.removeAllMarkers).not.toHaveBeenCalled();
    for (const defaults of Object.values(fixture.typescript)) {
      expect(defaults.setDiagnosticsOptions).not.toHaveBeenCalled();
    }
  });

  it("restores providers without subscribing to markers when defaults disappear", () => {
    builtin.trackBuiltinTs(fixture.monaco);
    fixture.languages.registerHoverProvider("typescript", {});
    builtin.suppressBuiltinTypeScriptFeatures(fixture.monaco);
    defaultsGetter.mockReturnValue(null);
    for (const defaults of Object.values(fixture.typescript)) {
      defaults.setDiagnosticsOptions.mockClear();
    }

    builtin.restoreBuiltinTypeScriptFeatures(fixture.monaco);

    expect(fixture.registrations.size).toBe(1);
    expect(fixture.editor.onDidChangeMarkers).not.toHaveBeenCalled();
    for (const defaults of Object.values(fixture.typescript)) {
      expect(defaults.setDiagnosticsOptions).not.toHaveBeenCalled();
    }
  });

  it("passes registrations and owner disposal through when OFF", () => {
    builtin.trackBuiltinTs(fixture.monaco);
    const provider = { provideHover: () => null };
    const owner = fixture.languages.registerHoverProvider(
      "typescript",
      provider,
    );
    expect([...fixture.registrations]).toEqual([
      { selector: "typescript", provider },
    ]);
    owner.dispose();
    expect(fixture.registrations.size).toBe(0);
  });

  it.each(overlapping)(
    "removes %s when ON and restores it across repeated cycles",
    (kind) => {
      builtin.trackBuiltinTs(fixture.monaco);
      const provider = {};
      fixture.languages[kind]("typescript", provider);
      fixture.languages[kind]("javascript", provider);
      for (let cycle = 0; cycle < 3; cycle++) {
        builtin.suppressBuiltinTypeScriptFeatures(fixture.monaco);
        builtin.suppressBuiltinTypeScriptFeatures(fixture.monaco);
        expect(fixture.registrations.size).toBe(0);
        builtin.restoreBuiltinTypeScriptFeatures(fixture.monaco);
        builtin.restoreBuiltinTypeScriptFeatures(fixture.monaco);
        expect([...fixture.registrations]).toEqual([
          { selector: "typescript", provider },
          { selector: "javascript", provider },
        ]);
      }
    },
  );

  it.each(
    ["json", { language: "typescript" }, ["typescript"], "*"].map(
      (selector) => ({ selector }),
    ),
  )("leaves non-exact selector $selector untouched when ON", ({ selector }) => {
    builtin.trackBuiltinTs(fixture.monaco);
    fixture.languages.registerHoverProvider(selector, {});
    const initial = [...fixture.registrations];
    builtin.suppressBuiltinTypeScriptFeatures(fixture.monaco);
    expect([...fixture.registrations]).toEqual(initial);
  });

  it.each(overlapping)(
    "passes a json %s registration straight to the original",
    (kind) => {
      builtin.trackBuiltinTs(fixture.monaco);
      const provider = {};
      fixture.languages[kind]("json", provider);
      builtin.suppressBuiltinTypeScriptFeatures(fixture.monaco);
      builtin.restoreBuiltinTypeScriptFeatures(fixture.monaco);
      expect([...fixture.registrations]).toEqual([
        { selector: "json", provider },
      ]);
    },
  );

  it("forwards code action metadata when registering and restoring", () => {
    const registerOriginal = vi.fn(
      fixture.languages.registerCodeActionProvider,
    );
    fixture.languages.registerCodeActionProvider = registerOriginal;
    builtin.trackBuiltinTs(fixture.monaco);
    const provider = { provideCodeActions: () => null };
    const metadata = { providedCodeActionKinds: ["quickfix"] };
    fixture.monaco.languages.registerCodeActionProvider(
      "typescript",
      provider,
      metadata,
    );
    builtin.suppressBuiltinTypeScriptFeatures(fixture.monaco);
    builtin.restoreBuiltinTypeScriptFeatures(fixture.monaco);
    expect(registerOriginal.mock.calls).toEqual([
      ["typescript", provider, metadata],
      ["typescript", provider, metadata],
    ]);
  });

  it.each(["typescript", "javascript"])(
    "holds lazy %s registration when already suppressed",
    (selector) => {
      builtin.suppressBuiltinTypeScriptFeatures(fixture.monaco);
      fixture.languages.registerHoverProvider(selector, {});
      expect(fixture.registrations.size).toBe(0);
      builtin.restoreBuiltinTypeScriptFeatures(fixture.monaco);
      expect([...fixture.registrations].map((entry) => entry.selector)).toEqual(
        [selector],
      );
    },
  );

  it.each(["before", "during", "after"])(
    "never resurrects an owner disposed %s suppression",
    (phase) => {
      builtin.trackBuiltinTs(fixture.monaco);
      const owner = fixture.languages.registerHoverProvider("typescript", {});
      if (phase === "before") owner.dispose();
      builtin.suppressBuiltinTypeScriptFeatures(fixture.monaco);
      if (phase === "during") owner.dispose();
      builtin.restoreBuiltinTypeScriptFeatures(fixture.monaco);
      if (phase === "after") owner.dispose();
      owner.dispose();
      builtin.suppressBuiltinTypeScriptFeatures(fixture.monaco);
      builtin.restoreBuiltinTypeScriptFeatures(fixture.monaco);
      expect(fixture.registrations.size).toBe(0);
    },
  );

  it("keeps the same wrappers and state when installed again after a module reload", async () => {
    builtin.trackBuiltinTs(fixture.monaco);
    const wrapped = fixture.languages.registerHoverProvider;
    fixture.languages.registerHoverProvider("typescript", {});
    builtin.suppressBuiltinTypeScriptFeatures(fixture.monaco);
    vi.resetModules();
    const reloaded = await import("@/lib/lsp/client/builtin-typescript");
    reloaded.trackBuiltinTs(fixture.monaco);
    expect(fixture.languages.registerHoverProvider).toBe(wrapped);
    reloaded.restoreBuiltinTypeScriptFeatures(fixture.monaco);
    expect(fixture.registrations.size).toBe(1);
  });

  it("leaves diagnostics configuration untouched when built-ins toggle", () => {
    // Given
    const defaults = Object.values(fixture.typescript);
    // When
    builtin.suppressBuiltinTypeScriptFeatures(fixture.monaco);
    builtin.restoreBuiltinTypeScriptFeatures(fixture.monaco);
    // Then: no defaults change event can kill or respawn a worker.
    for (const value of defaults) {
      expect(value.setModeConfiguration).not.toHaveBeenCalled();
      expect(value.setDiagnosticsOptions).not.toHaveBeenCalled();
    }
  });

  it("does not install a marker guard when diagnostics adapters are disabled", () => {
    // Given / When
    builtin.suppressBuiltinTypeScriptFeatures(fixture.monaco);
    // Then
    expect(fixture.editor.onDidChangeMarkers).not.toHaveBeenCalled();
    expect(fixture.editor.removeAllMarkers).not.toHaveBeenCalled();
  });

  it("restores providers and diagnostics when the controller reaches terminal failure", async () => {
    builtin.trackBuiltinTs(fixture.monaco);
    fixture.languages.registerHoverProvider("typescript", {});
    const snapshot =
      fixture.typescript.typescriptDefaults.getDiagnosticsOptions();
    builtin.suppressBuiltinTypeScriptFeatures(fixture.monaco);
    const restored = Promise.withResolvers<void>();
    const controller = createLspSessionController({
      fetchImpl: async () =>
        new Response(JSON.stringify({ error: "spawn failed" }), {
          status: 500,
        }),
      connect: vi.fn(),
      restoreBuiltin: () => {
        builtin.restoreBuiltinTypeScriptFeatures(fixture.monaco);
        restored.resolve();
      },
    });
    try {
      controller.update({
        isLspEnabled: true,
        isMonacoRegistered: true,
        hasAttachedEditor: true,
        workspace: { id: "ws", path: "/Workspace", backend: "local" },
        retryNonce: 0,
      });
      await restored.promise;
      expect(fixture.registrations.size).toBe(1);
      expect(
        fixture.typescript.typescriptDefaults.getDiagnosticsOptions(),
      ).toBe(snapshot);
    } finally {
      controller.dispose();
    }
  });
});
