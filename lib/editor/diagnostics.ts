import { Diagnostic, DiagnosticSeverity } from "@/types/diagnostics";

export const LINTABLE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"] as const;

export interface MonacoMarkerData {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
  message: string;
  severity: number;
  source?: string;
  code?: string | number;
}

// Monaco MarkerSeverity: Hint=1, Info=2, Warning=4, Error=8
// LSP DiagnosticSeverity: Error=1, Warning=2, Information=3, Hint=4
const LSP_TO_MONACO_SEVERITY: Record<DiagnosticSeverity, number> = {
  [DiagnosticSeverity.Error]: 8,
  [DiagnosticSeverity.Warning]: 4,
  [DiagnosticSeverity.Information]: 2,
  [DiagnosticSeverity.Hint]: 1,
};

export function mapToMonacoMarker(diagnostic: Diagnostic): MonacoMarkerData {
  return {
    startLineNumber: diagnostic.range.startLine,
    startColumn: diagnostic.range.startColumn,
    endLineNumber: diagnostic.range.endLine,
    endColumn: diagnostic.range.endColumn,
    message: diagnostic.message,
    severity: LSP_TO_MONACO_SEVERITY[diagnostic.severity],
    source: diagnostic.source,
    code: diagnostic.code,
  };
}

export interface MonacoMarkerLike {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
  message: string;
  severity: number;
  source?: string;
  code?: string | { value: string };
}

function monacoSeverityToDiagnosticSeverity(
  monacoSeverity: number,
): DiagnosticSeverity {
  switch (monacoSeverity) {
    case 8:
      return DiagnosticSeverity.Error;
    case 4:
      return DiagnosticSeverity.Warning;
    case 2:
      return DiagnosticSeverity.Information;
    case 1:
      return DiagnosticSeverity.Hint;
    default:
      return DiagnosticSeverity.Error;
  }
}

export function markerToDiagnostic(marker: MonacoMarkerLike): Diagnostic {
  return {
    message: marker.message,
    severity: monacoSeverityToDiagnosticSeverity(marker.severity),
    source: marker.source ?? "ts",
    code: typeof marker.code === "object" ? marker.code.value : marker.code,
    range: {
      startLine: marker.startLineNumber,
      startColumn: marker.startColumn,
      endLine: marker.endLineNumber,
      endColumn: marker.endColumn,
    },
  };
}
