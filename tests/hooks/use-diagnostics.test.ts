import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useDiagnosticsStore } from "@/stores/diagnostics-store";
import { useDiagnosticsForFile, useLintOnSave } from "@/hooks/use-diagnostics";
import { DiagnosticSeverity, type Diagnostic } from "@/types/diagnostics";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const errorDiagnostic: Diagnostic = {
  message: "Type error",
  severity: DiagnosticSeverity.Error,
  range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 10 },
  source: "tsc",
};

const warningDiagnostic: Diagnostic = {
  message: "Unused variable",
  severity: DiagnosticSeverity.Warning,
  range: { startLine: 5, startColumn: 1, endLine: 5, endColumn: 5 },
  source: "eslint",
};

describe("useDiagnosticsForFile", () => {
  beforeEach(() => {
    useDiagnosticsStore.getState().clearAllDiagnostics();
  });

  it("returns empty arrays when no diagnostics are stored", () => {
    const { result } = renderHook(() =>
      useDiagnosticsForFile("ws-1", "/src/app.ts"),
    );

    expect(result.current.diagnostics).toEqual([]);
    expect(result.current.errorCount).toBe(0);
    expect(result.current.warningCount).toBe(0);
  });

  it("returns empty arrays when workspaceId or filePath is undefined", () => {
    const { result } = renderHook(() =>
      useDiagnosticsForFile(undefined, "/src/app.ts"),
    );

    expect(result.current.diagnostics).toEqual([]);
    expect(result.current.errorCount).toBe(0);
    expect(result.current.warningCount).toBe(0);
  });

  it("returns stored diagnostics and correct counts", () => {
    useDiagnosticsStore
      .getState()
      .setDiagnostics("ws-1", "/src/app.ts", [
        errorDiagnostic,
        warningDiagnostic,
      ]);

    const { result } = renderHook(() =>
      useDiagnosticsForFile("ws-1", "/src/app.ts"),
    );

    expect(result.current.diagnostics).toHaveLength(2);
    expect(result.current.errorCount).toBe(1);
    expect(result.current.warningCount).toBe(1);
  });

  it("returns only diagnostics for the requested file", () => {
    useDiagnosticsStore
      .getState()
      .setDiagnostics("ws-1", "/src/app.ts", [errorDiagnostic]);
    useDiagnosticsStore
      .getState()
      .setDiagnostics("ws-1", "/src/other.ts", [warningDiagnostic]);

    const { result } = renderHook(() =>
      useDiagnosticsForFile("ws-1", "/src/app.ts"),
    );

    expect(result.current.diagnostics).toHaveLength(1);
    expect(result.current.diagnostics[0].message).toBe("Type error");
  });

  it("reacts to store updates", async () => {
    const { result } = renderHook(() =>
      useDiagnosticsForFile("ws-1", "/src/app.ts"),
    );

    expect(result.current.diagnostics).toHaveLength(0);

    act(() => {
      useDiagnosticsStore
        .getState()
        .setDiagnostics("ws-1", "/src/app.ts", [errorDiagnostic]);
    });

    await waitFor(() => {
      expect(result.current.diagnostics).toHaveLength(1);
    });
  });
});

describe("useLintOnSave", () => {
  beforeEach(() => {
    mockFetch.mockClear();
    useDiagnosticsStore.getState().clearAllDiagnostics();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("does not call fetch when workspaceId is undefined", async () => {
    const { result } = renderHook(() =>
      useLintOnSave(undefined, "/src/app.ts"),
    );

    await act(async () => {
      await result.current.lintFile();
    });

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("does not call fetch for non-lintable file extensions", async () => {
    const { result } = renderHook(() =>
      useLintOnSave("ws-1", "/src/data.json"),
    );

    await act(async () => {
      await result.current.lintFile();
    });

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("does not call fetch for .md files", async () => {
    const { result } = renderHook(() =>
      useLintOnSave("ws-1", "/docs/readme.md"),
    );

    await act(async () => {
      await result.current.lintFile();
    });

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("calls fetch for .ts files with correct URL and body", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        diagnostics: [],
        filePath: "/src/app.ts",
        duration: 100,
      }),
    });

    const { result } = renderHook(() => useLintOnSave("ws-1", "/src/app.ts"));

    await act(async () => {
      await result.current.lintFile();
    });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/files/lint");
    expect(options.method).toBe("POST");
    expect(JSON.parse(options.body as string)).toEqual({
      workspaceId: "ws-1",
      filePath: "/src/app.ts",
    });
  });

  it("calls fetch for .tsx files", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        diagnostics: [],
        filePath: "/src/App.tsx",
        duration: 50,
      }),
    });

    const { result } = renderHook(() => useLintOnSave("ws-1", "/src/App.tsx"));

    await act(async () => {
      await result.current.lintFile();
    });

    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("populates the store with diagnostics on successful response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        diagnostics: [errorDiagnostic, warningDiagnostic],
        filePath: "/src/app.ts",
        duration: 200,
      }),
    });

    const { result } = renderHook(() => useLintOnSave("ws-1", "/src/app.ts"));

    await act(async () => {
      await result.current.lintFile();
    });

    const stored = useDiagnosticsStore
      .getState()
      .getDiagnosticsForFile("ws-1", "/src/app.ts");

    expect(stored).toHaveLength(2);
    expect(stored[0].message).toBe("Type error");
    expect(stored[1].message).toBe("Unused variable");
  });

  it("does not update store when response is not ok", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 422,
      json: async () => ({ error: "UNSUPPORTED_FILE" }),
    });

    const { result } = renderHook(() => useLintOnSave("ws-1", "/src/app.ts"));

    await act(async () => {
      await result.current.lintFile();
    });

    const stored = useDiagnosticsStore
      .getState()
      .getDiagnosticsForFile("ws-1", "/src/app.ts");

    expect(stored).toHaveLength(0);
  });

  it("isLinting resets to false after completion", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        diagnostics: [],
        filePath: "/src/app.ts",
        duration: 10,
      }),
    });

    const { result } = renderHook(() => useLintOnSave("ws-1", "/src/app.ts"));

    expect(result.current.isLinting).toBe(false);

    await act(async () => {
      await result.current.lintFile();
    });

    expect(result.current.isLinting).toBe(false);
  });
});
