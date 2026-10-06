import { describe, it, expect, beforeEach, vi } from "vitest";
import { useDiagnosticsStore } from "@/stores/diagnostics-store";
import { DiagnosticSeverity, type Diagnostic } from "@/types/diagnostics";

const makeRange = () => ({
  startLine: 1,
  startColumn: 0,
  endLine: 1,
  endColumn: 10,
});

const makeDiagnostic = (
  severity: DiagnosticSeverity,
  message = "test",
): Diagnostic => ({
  message,
  severity,
  range: makeRange(),
  source: "test",
});

describe("useDiagnosticsStore", () => {
  beforeEach(() => {
    useDiagnosticsStore.setState({
      diagnosticsByFile: new Map(),
      diagnosticsBySource: new Map(),
      pendingRequests: new Map(),
    });
  });

  it("setDiagnostics stores and retrieves diagnostics via getDiagnosticsForFile", () => {
    const diags: Diagnostic[] = [
      makeDiagnostic(DiagnosticSeverity.Error, "error one"),
    ];
    useDiagnosticsStore.getState().setDiagnostics("ws1", "src/foo.ts", diags);

    const result = useDiagnosticsStore
      .getState()
      .getDiagnosticsForFile("ws1", "src/foo.ts");
    expect(result).toEqual(diags);
  });

  it("clearDiagnostics removes diagnostics — getDiagnosticsForFile returns []", () => {
    const diags: Diagnostic[] = [makeDiagnostic(DiagnosticSeverity.Warning)];
    useDiagnosticsStore.getState().setDiagnostics("ws1", "src/bar.ts", diags);
    useDiagnosticsStore.getState().clearDiagnostics("ws1", "src/bar.ts");

    const result = useDiagnosticsStore
      .getState()
      .getDiagnosticsForFile("ws1", "src/bar.ts");
    expect(result).toEqual([]);
  });

  it("getErrorCount returns correct count for mixed error/warning diagnostics", () => {
    const diags: Diagnostic[] = [
      makeDiagnostic(DiagnosticSeverity.Error, "e1"),
      makeDiagnostic(DiagnosticSeverity.Error, "e2"),
      makeDiagnostic(DiagnosticSeverity.Warning, "w1"),
    ];
    useDiagnosticsStore.getState().setDiagnostics("ws2", "src/baz.ts", diags);

    const count = useDiagnosticsStore
      .getState()
      .getErrorCount("ws2", "src/baz.ts");
    expect(count).toBe(2);
  });

  it("getWarningCount returns correct count for mixed diagnostics", () => {
    const diags: Diagnostic[] = [
      makeDiagnostic(DiagnosticSeverity.Error, "e1"),
      makeDiagnostic(DiagnosticSeverity.Warning, "w1"),
      makeDiagnostic(DiagnosticSeverity.Warning, "w2"),
      makeDiagnostic(DiagnosticSeverity.Information, "i1"),
    ];
    useDiagnosticsStore.getState().setDiagnostics("ws2", "src/qux.ts", diags);

    const count = useDiagnosticsStore
      .getState()
      .getWarningCount("ws2", "src/qux.ts");
    expect(count).toBe(2);
  });

  it("cancelPendingRequest calls AbortController.abort()", () => {
    const controller = new AbortController();
    const abortSpy = vi.spyOn(controller, "abort");

    useDiagnosticsStore
      .getState()
      .registerPendingRequest("ws1:file.ts", controller);
    useDiagnosticsStore.getState().cancelPendingRequest("ws1:file.ts");

    expect(abortSpy).toHaveBeenCalledOnce();
    const pending = useDiagnosticsStore
      .getState()
      .pendingRequests.get("ws1:file.ts");
    expect(pending).toBeUndefined();
  });

  it("store is not persisted (no persist property)", () => {
    expect(
      (useDiagnosticsStore as unknown as { persist?: unknown }).persist,
    ).toBeUndefined();
  });

  // Regression: inline `?? []` in Zustand selectors creates new references
  // per render, causing useSyncExternalStore infinite loops.
  describe("selector referential stability", () => {
    it("raw ?? [] returns different references per call (proves instability)", () => {
      const unstableSelector = (s: {
        diagnosticsByFile: Map<string, unknown[]>;
      }) => s.diagnosticsByFile.get("ws1:missing.ts") ?? [];

      const a = unstableSelector(useDiagnosticsStore.getState());
      const b = unstableSelector(useDiagnosticsStore.getState());

      expect(a).not.toBe(b);
    });

    it("getDiagnosticsForFile returns equal empty array for missing file", () => {
      const a = useDiagnosticsStore
        .getState()
        .getDiagnosticsForFile("ws1", "missing.ts");
      const b = useDiagnosticsStore
        .getState()
        .getDiagnosticsForFile("ws1", "missing.ts");

      expect(a).toEqual(b);
      expect(a).toEqual([]);
    });
  });

  it("clearAllDiagnostics resets all diagnostics to empty map", () => {
    useDiagnosticsStore
      .getState()
      .setDiagnostics("ws1", "a.ts", [
        makeDiagnostic(DiagnosticSeverity.Error),
      ]);
    useDiagnosticsStore
      .getState()
      .setDiagnostics("ws2", "b.ts", [
        makeDiagnostic(DiagnosticSeverity.Warning),
      ]);

    useDiagnosticsStore.getState().clearAllDiagnostics();

    expect(
      useDiagnosticsStore.getState().getDiagnosticsForFile("ws1", "a.ts"),
    ).toEqual([]);
    expect(
      useDiagnosticsStore.getState().getDiagnosticsForFile("ws2", "b.ts"),
    ).toEqual([]);
  });

  describe("source-scoped diagnostics", () => {
    const eslintDiagnostic = makeDiagnostic(
      DiagnosticSeverity.Warning,
      "eslint warning",
    );
    const typescriptDiagnostic = makeDiagnostic(
      DiagnosticSeverity.Error,
      "ts error",
    );

    it("merges sources into diagnosticsByFile with eslint first", () => {
      const store = useDiagnosticsStore.getState();
      store.setDiagnosticsForSource("ws1", "a.ts", "typescript", [
        typescriptDiagnostic,
      ]);
      store.setDiagnosticsForSource("ws1", "a.ts", "eslint", [
        eslintDiagnostic,
      ]);

      expect(
        useDiagnosticsStore.getState().getDiagnosticsForFile("ws1", "a.ts"),
      ).toEqual([eslintDiagnostic, typescriptDiagnostic]);
    });

    it("clearing one source keeps the other source's diagnostics", () => {
      const store = useDiagnosticsStore.getState();
      store.setDiagnosticsForSource("ws1", "a.ts", "eslint", [
        eslintDiagnostic,
      ]);
      store.setDiagnosticsForSource("ws1", "a.ts", "typescript", [
        typescriptDiagnostic,
      ]);

      useDiagnosticsStore
        .getState()
        .clearDiagnosticsForSource("ws1", "a.ts", "typescript");

      const state = useDiagnosticsStore.getState();
      expect(state.getDiagnosticsForFile("ws1", "a.ts")).toEqual([
        eslintDiagnostic,
      ]);
      expect(state.diagnosticsBySource.get("ws1:a.ts")?.typescript).toBe(
        undefined,
      );
    });

    it("deletes the key from both maps when every source is empty", () => {
      const store = useDiagnosticsStore.getState();
      store.setDiagnosticsForSource("ws1", "a.ts", "typescript", [
        typescriptDiagnostic,
      ]);

      useDiagnosticsStore
        .getState()
        .clearDiagnosticsForSource("ws1", "a.ts", "typescript");

      const state = useDiagnosticsStore.getState();
      expect(state.diagnosticsByFile.has("ws1:a.ts")).toBe(false);
      expect(state.diagnosticsBySource.has("ws1:a.ts")).toBe(false);
    });

    it("clearSourceForWorkspace leaves other workspaces and sources intact", () => {
      const store = useDiagnosticsStore.getState();
      store.setDiagnosticsForSource("ws1", "a.ts", "typescript", [
        typescriptDiagnostic,
      ]);
      store.setDiagnosticsForSource("ws1", "b.ts", "typescript", [
        typescriptDiagnostic,
      ]);
      store.setDiagnosticsForSource("ws1", "b.ts", "eslint", [
        eslintDiagnostic,
      ]);
      store.setDiagnosticsForSource("ws10", "a.ts", "typescript", [
        typescriptDiagnostic,
      ]);

      useDiagnosticsStore
        .getState()
        .clearSourceForWorkspace("ws1", "typescript");

      const state = useDiagnosticsStore.getState();
      expect(state.diagnosticsByFile.has("ws1:a.ts")).toBe(false);
      expect(state.getDiagnosticsForFile("ws1", "b.ts")).toEqual([
        eslintDiagnostic,
      ]);
      expect(state.getDiagnosticsForFile("ws10", "a.ts")).toEqual([
        typescriptDiagnostic,
      ]);
    });

    it("setDiagnostics writes the eslint source and preserves typescript", () => {
      useDiagnosticsStore
        .getState()
        .setDiagnosticsForSource("ws1", "a.ts", "typescript", [
          typescriptDiagnostic,
        ]);

      useDiagnosticsStore
        .getState()
        .setDiagnostics("ws1", "a.ts", [eslintDiagnostic]);

      const state = useDiagnosticsStore.getState();
      expect(state.diagnosticsBySource.get("ws1:a.ts")).toEqual({
        eslint: [eslintDiagnostic],
        typescript: [typescriptDiagnostic],
      });
      expect(state.getDiagnosticsForFile("ws1", "a.ts")).toEqual([
        eslintDiagnostic,
        typescriptDiagnostic,
      ]);
    });

    it("clearDiagnostics removes both sources for the file", () => {
      const store = useDiagnosticsStore.getState();
      store.setDiagnosticsForSource("ws1", "a.ts", "eslint", [
        eslintDiagnostic,
      ]);
      store.setDiagnosticsForSource("ws1", "a.ts", "typescript", [
        typescriptDiagnostic,
      ]);

      useDiagnosticsStore.getState().clearDiagnostics("ws1", "a.ts");

      const state = useDiagnosticsStore.getState();
      expect(state.diagnosticsByFile.has("ws1:a.ts")).toBe(false);
      expect(state.diagnosticsBySource.has("ws1:a.ts")).toBe(false);
    });

    it("clearAllDiagnostics resets the source map too", () => {
      useDiagnosticsStore
        .getState()
        .setDiagnosticsForSource("ws1", "a.ts", "typescript", [
          typescriptDiagnostic,
        ]);

      useDiagnosticsStore.getState().clearAllDiagnostics();

      expect(useDiagnosticsStore.getState().diagnosticsBySource.size).toBe(0);
    });

    it("a typescript write keeps the stored eslint array reference", () => {
      const eslintDiagnostics = [eslintDiagnostic];
      useDiagnosticsStore
        .getState()
        .setDiagnostics("ws1", "a.ts", eslintDiagnostics);
      const eslintBefore = useDiagnosticsStore
        .getState()
        .diagnosticsBySource.get("ws1:a.ts")?.eslint;

      useDiagnosticsStore
        .getState()
        .setDiagnosticsForSource("ws1", "a.ts", "typescript", [
          typescriptDiagnostic,
        ]);

      const eslintAfter = useDiagnosticsStore
        .getState()
        .diagnosticsBySource.get("ws1:a.ts")?.eslint;
      expect(eslintBefore).toBe(eslintDiagnostics);
      expect(eslintAfter).toBe(eslintBefore);
    });
  });
});
