export enum DiagnosticSeverity {
  Error = 1,
  Warning = 2,
  Information = 3,
  Hint = 4,
}

export interface DiagnosticRange {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

export interface Diagnostic {
  message: string;
  severity: DiagnosticSeverity;
  range: DiagnosticRange;
  source: string;
  code?: string | number;
}

export interface LintResponse {
  diagnostics: Diagnostic[];
  filePath: string;
  duration: number;
}

export interface LintErrorResponse {
  error: string;
  code: "NO_CONFIG" | "LINT_FAILED" | "TIMEOUT" | "UNSUPPORTED_FILE";
}
