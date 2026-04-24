import type { ESLint as ESLintType } from "eslint";
import type { Diagnostic, LintResponse } from "@/types/diagnostics";
import { DiagnosticSeverity } from "@/types/diagnostics";

export interface LintFileOptions {
  workspacePath: string;
  absoluteFilePath: string;
  filePath: string;
}

export class LintServiceError extends Error {
  constructor(
    message: string,
    public readonly code: "NO_CONFIG" | "LINT_FAILED" | "TIMEOUT",
  ) {
    super(message);
    this.name = "LintServiceError";
  }
}

const LINT_TIMEOUT_MS = 10_000;

export async function lintFile(
  options: LintFileOptions,
): Promise<LintResponse> {
  const start = Date.now();

  const lintPromise = runEslint(options);
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new LintServiceError("ESLint timed out", "TIMEOUT")),
      LINT_TIMEOUT_MS,
    ),
  );

  const diagnostics = await Promise.race([lintPromise, timeoutPromise]);
  const duration = Date.now() - start;

  return { diagnostics, filePath: options.filePath, duration };
}

async function runEslint(options: LintFileOptions): Promise<Diagnostic[]> {
  const { ESLint } = await import("eslint");

  const eslint = new ESLint({ cwd: options.workspacePath });

  let results: ESLintType.LintResult[];
  try {
    results = await eslint.lintFiles([options.absoluteFilePath]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("No ESLint configuration")) {
      throw new LintServiceError(message, "NO_CONFIG");
    }
    throw new LintServiceError(message, "LINT_FAILED");
  }

  const diagnostics: Diagnostic[] = [];

  for (const result of results) {
    for (const msg of result.messages) {
      const severity =
        msg.severity === 1
          ? DiagnosticSeverity.Warning
          : DiagnosticSeverity.Error;

      diagnostics.push({
        message: msg.message,
        severity,
        range: {
          startLine: msg.line,
          startColumn: msg.column,
          endLine: msg.endLine ?? msg.line,
          endColumn: msg.endColumn ?? msg.column,
        },
        source: "eslint",
        code: msg.ruleId ?? undefined,
      });
    }
  }

  return diagnostics;
}
