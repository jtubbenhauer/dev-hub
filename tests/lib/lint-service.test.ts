import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { DiagnosticSeverity } from "@/types/diagnostics";
import { lintFile, LintServiceError } from "@/lib/editor/lint-service";
import type { LintFileOptions } from "@/lib/editor/lint-service";

type FakeMessage = {
  message: string;
  severity: 1 | 2;
  line: number;
  column: number;
  endLine: number | null;
  endColumn: number | null;
  ruleId: string | null;
};

type MockBehavior =
  | { type: "resolve"; results: { messages: FakeMessage[] }[] }
  | { type: "reject"; error: Error }
  | { type: "hang" };

let mockBehavior: MockBehavior = { type: "resolve", results: [] };

vi.mock("eslint", () => {
  const ESLint = vi.fn().mockImplementation(function () {
    return {
      lintFiles: () => {
        if (mockBehavior.type === "resolve") {
          return Promise.resolve(mockBehavior.results);
        }
        if (mockBehavior.type === "reject") {
          return Promise.reject(mockBehavior.error);
        }
        return new Promise(() => {});
      },
    };
  });
  return { ESLint };
});

function makeMsg(overrides: Partial<FakeMessage> = {}): FakeMessage {
  return {
    message: "Some lint message",
    severity: 2,
    line: 3,
    column: 5,
    endLine: 3,
    endColumn: 10,
    ruleId: "no-unused-vars",
    ...overrides,
  };
}

const OPTIONS: LintFileOptions = {
  workspacePath: "/workspace",
  absoluteFilePath: "/workspace/src/foo.ts",
  filePath: "src/foo.ts",
};

describe("lintFile", () => {
  beforeEach(() => {
    mockBehavior = { type: "resolve", results: [] };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("maps severity=2 messages to DiagnosticSeverity.Error", async () => {
    mockBehavior = {
      type: "resolve",
      results: [{ messages: [makeMsg({ severity: 2, ruleId: "no-undef" })] }],
    };

    const result = await lintFile(OPTIONS);

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].severity).toBe(DiagnosticSeverity.Error);
    expect(result.diagnostics[0].source).toBe("eslint");
  });

  it("maps severity=1 messages to DiagnosticSeverity.Warning", async () => {
    mockBehavior = {
      type: "resolve",
      results: [
        {
          messages: [
            makeMsg({ severity: 1, message: "prefer-const violation" }),
          ],
        },
      ],
    };

    const result = await lintFile(OPTIONS);

    expect(result.diagnostics[0].severity).toBe(DiagnosticSeverity.Warning);
  });

  it("returns empty diagnostics array when no messages", async () => {
    mockBehavior = { type: "resolve", results: [{ messages: [] }] };

    const result = await lintFile(OPTIONS);

    expect(result.diagnostics).toEqual([]);
    expect(result.filePath).toBe("src/foo.ts");
    expect(typeof result.duration).toBe("number");
  });

  it("maps range fields correctly with explicit endLine/endColumn", async () => {
    mockBehavior = {
      type: "resolve",
      results: [
        {
          messages: [
            makeMsg({ line: 7, column: 2, endLine: 7, endColumn: 15 }),
          ],
        },
      ],
    };

    const result = await lintFile(OPTIONS);

    expect(result.diagnostics[0].range).toEqual({
      startLine: 7,
      startColumn: 2,
      endLine: 7,
      endColumn: 15,
    });
  });

  it("falls back to startLine/startColumn when endLine/endColumn are null", async () => {
    mockBehavior = {
      type: "resolve",
      results: [
        {
          messages: [
            makeMsg({ line: 4, column: 8, endLine: null, endColumn: null }),
          ],
        },
      ],
    };

    const result = await lintFile(OPTIONS);

    expect(result.diagnostics[0].range).toEqual({
      startLine: 4,
      startColumn: 8,
      endLine: 4,
      endColumn: 8,
    });
  });

  it("preserves ruleId as diagnostic.code", async () => {
    mockBehavior = {
      type: "resolve",
      results: [{ messages: [makeMsg({ ruleId: "no-unused-vars" })] }],
    };

    const result = await lintFile(OPTIONS);

    expect(result.diagnostics[0].code).toBe("no-unused-vars");
  });

  it("sets code to undefined when ruleId is null", async () => {
    mockBehavior = {
      type: "resolve",
      results: [{ messages: [makeMsg({ ruleId: null })] }],
    };

    const result = await lintFile(OPTIONS);

    expect(result.diagnostics[0].code).toBeUndefined();
  });

  it("throws LintServiceError with code LINT_FAILED on generic ESLint error", async () => {
    mockBehavior = {
      type: "reject",
      error: new Error("Something went wrong"),
    };

    await expect(lintFile(OPTIONS)).rejects.toMatchObject({
      code: "LINT_FAILED",
      name: "LintServiceError",
    });
  });

  it("throws LintServiceError with code NO_CONFIG when ESLint config is missing", async () => {
    mockBehavior = {
      type: "reject",
      error: new Error("No ESLint configuration file found"),
    };

    await expect(lintFile(OPTIONS)).rejects.toMatchObject({
      code: "NO_CONFIG",
    });
  });

  it("throws LintServiceError with code TIMEOUT when lint takes too long", async () => {
    vi.useFakeTimers();
    mockBehavior = { type: "hang" };

    const resultPromise = lintFile(OPTIONS);
    resultPromise.catch(() => {});

    await vi.advanceTimersByTimeAsync(11_000);

    await expect(resultPromise).rejects.toMatchObject({
      code: "TIMEOUT",
    });
  });
});

describe("LintServiceError", () => {
  it("has the correct name and code properties", () => {
    const err = new LintServiceError("timed out", "TIMEOUT");
    expect(err.name).toBe("LintServiceError");
    expect(err.code).toBe("TIMEOUT");
    expect(err.message).toBe("timed out");
    expect(err instanceof Error).toBe(true);
  });
});
