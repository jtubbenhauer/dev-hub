import { describe, it, expect } from "vitest";
import { mapToMonacoMarker } from "@/lib/editor/diagnostics";
import { DiagnosticSeverity } from "@/types/diagnostics";
import type { Diagnostic } from "@/types/diagnostics";

const baseRange = {
  startLine: 5,
  startColumn: 3,
  endLine: 5,
  endColumn: 20,
};

describe("mapToMonacoMarker", () => {
  it("maps Warning diagnostic to Monaco severity 4", () => {
    const diagnostic: Diagnostic = {
      message: "Unused variable",
      severity: DiagnosticSeverity.Warning,
      range: baseRange,
      source: "eslint",
    };

    const marker = mapToMonacoMarker(diagnostic);

    expect(marker.severity).toBe(4);
    expect(marker.startLineNumber).toBe(5);
    expect(marker.startColumn).toBe(3);
    expect(marker.endLineNumber).toBe(5);
    expect(marker.endColumn).toBe(20);
  });

  it("maps Error diagnostic to Monaco severity 8", () => {
    const diagnostic: Diagnostic = {
      message: "Type error",
      severity: DiagnosticSeverity.Error,
      range: baseRange,
      source: "typescript",
    };

    const marker = mapToMonacoMarker(diagnostic);

    expect(marker.severity).toBe(8);
  });

  it("maps Information diagnostic to Monaco severity 2", () => {
    const diagnostic: Diagnostic = {
      message: "Consider using const",
      severity: DiagnosticSeverity.Information,
      range: baseRange,
      source: "eslint",
    };

    const marker = mapToMonacoMarker(diagnostic);

    expect(marker.severity).toBe(2);
  });

  it("maps Hint diagnostic to Monaco severity 1", () => {
    const diagnostic: Diagnostic = {
      message: "Refactor suggestion",
      severity: DiagnosticSeverity.Hint,
      range: baseRange,
      source: "ts-server",
    };

    const marker = mapToMonacoMarker(diagnostic);

    expect(marker.severity).toBe(1);
  });

  it("preserves message, source, and code", () => {
    const diagnostic: Diagnostic = {
      message: "Expected semicolon",
      severity: DiagnosticSeverity.Error,
      range: baseRange,
      source: "prettier",
      code: "semi",
    };

    const marker = mapToMonacoMarker(diagnostic);

    expect(marker.message).toBe("Expected semicolon");
    expect(marker.source).toBe("prettier");
    expect(marker.code).toBe("semi");
  });

  it("preserves numeric code", () => {
    const diagnostic: Diagnostic = {
      message: "Type mismatch",
      severity: DiagnosticSeverity.Error,
      range: baseRange,
      source: "typescript",
      code: 2322,
    };

    const marker = mapToMonacoMarker(diagnostic);

    expect(marker.code).toBe(2322);
  });
});
