import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createSessionFixture, fakeUri } from "./lsp-session-fixture";
import { createLspSessionController } from "@/lib/lsp/client/session-controller";

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
] as const;
const preserved = [
  "registerReferenceProvider",
  "registerRenameProvider",
  "registerDocumentHighlightProvider",
  "registerDocumentSymbolProvider",
  "registerCodeActionProvider",
] as const;

describe("built-in TypeScript registrations", () => {
  beforeEach(async () => {
    vi.resetModules();
    builtin = await import("@/lib/lsp/client/builtin-typescript");
    fixture = createSessionFixture();
  });
  afterEach(() => vi.restoreAllMocks());

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

  it.each(preserved)("leaves %s built-in when ON", (kind) => {
    builtin.trackBuiltinTs(fixture.monaco);
    fixture.languages[kind]("typescript", {});
    builtin.suppressBuiltinTypeScriptFeatures(fixture.monaco);
    expect(fixture.registrations.size).toBe(1);
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

  it("restores each exact diagnostics snapshot when OFF or terminal failure restores built-ins", () => {
    const defaults = Object.values(fixture.typescript);
    const snapshots = defaults.map((value) => value.getDiagnosticsOptions());
    builtin.restoreBuiltinTypeScriptFeatures(fixture.monaco);
    builtin.suppressBuiltinTypeScriptFeatures(fixture.monaco);
    builtin.suppressBuiltinTypeScriptFeatures(fixture.monaco);
    defaults.forEach((value, index) => {
      expect(value.getDiagnosticsOptions()).toEqual({
        ...snapshots[index],
        noSemanticValidation: true,
        noSyntaxValidation: true,
        noSuggestionDiagnostics: true,
      });
      expect(value.setModeConfiguration).not.toHaveBeenCalled();
      expect(value.setDiagnosticsOptions).toHaveBeenCalledTimes(1);
    });
    builtin.restoreBuiltinTypeScriptFeatures(fixture.monaco);
    defaults.forEach((value, index) =>
      expect(value.getDiagnosticsOptions()).toBe(snapshots[index]),
    );
    const next = { noSemanticValidation: false, onlyVisible: true };
    defaults[0].setDiagnosticsOptions(next);
    builtin.suppressBuiltinTypeScriptFeatures(fixture.monaco);
    builtin.restoreBuiltinTypeScriptFeatures(fixture.monaco);
    expect(defaults[0].getDiagnosticsOptions()).toBe(next);
  });

  it("clears existing and late builtin markers without recursive empty-marker clearing", () => {
    const uri = fakeUri("file:///Workspace/src/a.ts");
    const marker = {
      resource: uri,
      severity: 8,
      message: "late",
      startLineNumber: 1,
      startColumn: 1,
      endLineNumber: 1,
      endColumn: 2,
    };
    let markers = ["typescript", "javascript", "lsp", "eslint"].map(
      (owner) => ({ ...marker, owner }),
    );
    fixture.editor.getModelMarkers.mockImplementation(({ owner }) =>
      markers.filter((entry) => entry.owner === owner),
    );
    fixture.editor.removeAllMarkers.mockImplementation((owner) => {
      markers = markers.filter((entry) => entry.owner !== owner);
      fixture.editor.onDidChangeMarkers.mock.calls[0]?.[0]([uri]);
    });
    builtin.suppressBuiltinTypeScriptFeatures(fixture.monaco);
    expect(markers.map((entry) => entry.owner)).toEqual(["lsp", "eslint"]);
    fixture.editor.removeAllMarkers.mockClear();
    markers.push({ ...marker, owner: "typescript" });
    fixture.editor.onDidChangeMarkers.mock.calls[0]?.[0]([uri]);
    expect(fixture.editor.removeAllMarkers.mock.calls).toEqual([
      ["typescript"],
    ]);
    builtin.restoreBuiltinTypeScriptFeatures(fixture.monaco);
    expect(fixture.mirrorDisposable.dispose).toHaveBeenCalledOnce();
    markers.push({ ...marker, owner: "javascript" });
    fixture.editor.onDidChangeMarkers.mock.calls[0]?.[0]([uri]);
    expect(markers.some((entry) => entry.owner === "javascript")).toBe(true);
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
