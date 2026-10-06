import { describe, it, expect } from "vitest";
import { mapToMonacoMarker } from "@/lib/editor/diagnostics";
import {
  markerToDiagnostic,
  type MonacoMarkerLike,
} from "@/lib/editor/diagnostics";
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

describe("markerToDiagnostic", () => {
  const baseMarker: MonacoMarkerLike = {
    startLineNumber: 7,
    startColumn: 2,
    endLineNumber: 9,
    endColumn: 14,
    message: "Type 'string' is not assignable to type 'number'.",
    severity: 8,
    source: "typescript",
    code: "2322",
  };

  it("maps position, message, source and string code into a Diagnostic", () => {
    expect(markerToDiagnostic(baseMarker)).toEqual({
      message: "Type 'string' is not assignable to type 'number'.",
      severity: DiagnosticSeverity.Error,
      source: "typescript",
      code: "2322",
      range: { startLine: 7, startColumn: 2, endLine: 9, endColumn: 14 },
    });
  });

  it.each([
    [8, DiagnosticSeverity.Error],
    [4, DiagnosticSeverity.Warning],
    [2, DiagnosticSeverity.Information],
    [1, DiagnosticSeverity.Hint],
    [3, DiagnosticSeverity.Error],
  ])("maps Monaco severity %i to DiagnosticSeverity %i", (input, expected) => {
    expect(
      markerToDiagnostic({ ...baseMarker, severity: input }).severity,
    ).toBe(expected);
  });

  it("defaults source to ts when the marker has none", () => {
    const markerWithoutSource: MonacoMarkerLike = { ...baseMarker };
    delete markerWithoutSource.source;

    expect(markerToDiagnostic(markerWithoutSource).source).toBe("ts");
  });

  it("unwraps an object code to its value", () => {
    const diagnostic = markerToDiagnostic({
      ...baseMarker,
      code: { value: "7006" },
    });

    expect(diagnostic.code).toBe("7006");
  });

  it("leaves code undefined when the marker has none", () => {
    const markerWithoutCode: MonacoMarkerLike = { ...baseMarker };
    delete markerWithoutCode.code;

    expect(markerToDiagnostic(markerWithoutCode).code).toBeUndefined();
  });

  it("round-trips through mapToMonacoMarker positions", () => {
    const marker = mapToMonacoMarker(markerToDiagnostic(baseMarker));

    expect(marker).toMatchObject({
      startLineNumber: 7,
      startColumn: 2,
      endLineNumber: 9,
      endColumn: 14,
      severity: 8,
    });
  });
});
