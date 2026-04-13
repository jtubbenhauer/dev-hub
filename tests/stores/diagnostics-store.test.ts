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
});
