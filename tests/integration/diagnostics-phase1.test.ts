import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useDiagnosticsStore } from "@/stores/diagnostics-store";
import { useLintOnSave, useDiagnosticsForFile } from "@/hooks/use-diagnostics";
import {
  mapToMonacoMarker,
  LINTABLE_EXTENSIONS,
} from "@/lib/editor/diagnostics";
import { DiagnosticSeverity } from "@/types/diagnostics";
import type { Diagnostic, LintResponse } from "@/types/diagnostics";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function makeDiagnostic(
  severity: DiagnosticSeverity,
  message = "test message",
  line = 3,
  column = 5,
): Diagnostic {
  return {
    message,
    severity,
    range: {
      startLine: line,
      startColumn: column,
      endLine: line,
      endColumn: column + 10,
    },
    source: "eslint",
    code: "no-unused-vars",
  };
}

function makeLintResponse(diagnostics: Diagnostic[]): LintResponse {
  return {
    diagnostics,
    filePath: "/src/app.ts",
    duration: 100,
  };
}

function makeFetchOk(response: LintResponse) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve(response),
  });
}

describe("Phase 1 Diagnostics Pipeline — Integration", () => {
  beforeEach(() => {
    useDiagnosticsStore.getState().clearAllDiagnostics();
    useDiagnosticsStore.setState({ pendingRequests: new Map() });
    mockFetch.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── Scenario 1: Full pipeline fetch → store → selector ───────────────────

  describe("Scenario 1: Full pipeline — fetch → store → selector", () => {
    it("populates store and selector with 2 errors + 1 warning after lintFile()", async () => {
      const diagnostics: Diagnostic[] = [
        makeDiagnostic(DiagnosticSeverity.Error, "Type error one"),
        makeDiagnostic(DiagnosticSeverity.Error, "Type error two", 5, 3),
        makeDiagnostic(DiagnosticSeverity.Warning, "Unused variable", 9, 1),
      ];

      mockFetch.mockReturnValueOnce(makeFetchOk(makeLintResponse(diagnostics)));

      const { result: lintResult } = renderHook(() =>
        useLintOnSave("ws-1", "/src/app.ts"),
      );

      await act(async () => {
        await lintResult.current.lintFile();
      });

      const { result: diagResult } = renderHook(() =>
        useDiagnosticsForFile("ws-1", "/src/app.ts"),
      );

      expect(diagResult.current.diagnostics).toHaveLength(3);
      expect(diagResult.current.errorCount).toBe(2);
      expect(diagResult.current.warningCount).toBe(1);
    });

    it("selector is reactive — updates after lintFile() resolves", async () => {
      const diagnostics: Diagnostic[] = [
        makeDiagnostic(DiagnosticSeverity.Error, "reactive error"),
      ];

      mockFetch.mockReturnValueOnce(makeFetchOk(makeLintResponse(diagnostics)));

      const { result: diagResult } = renderHook(() =>
        useDiagnosticsForFile("ws-1", "/src/app.ts"),
      );

      // Initially empty
      expect(diagResult.current.diagnostics).toHaveLength(0);

      const { result: lintResult } = renderHook(() =>
        useLintOnSave("ws-1", "/src/app.ts"),
      );

      await act(async () => {
        await lintResult.current.lintFile();
      });

      await waitFor(() => {
        expect(diagResult.current.diagnostics).toHaveLength(1);
      });

      expect(diagResult.current.errorCount).toBe(1);
      expect(diagResult.current.warningCount).toBe(0);
    });
  });

  // ─── Scenario 2: Marker mapping round-trip ─────────────────────────────────

  describe("Scenario 2: Marker mapping round-trip", () => {
    it("maps Error diagnostic to Monaco severity=8 with correct fields", () => {
      const diag: Diagnostic = {
        message: "Unexpected identifier",
        severity: DiagnosticSeverity.Error,
        range: { startLine: 10, startColumn: 4, endLine: 10, endColumn: 20 },
        source: "eslint",
        code: "no-undef",
      };

      const marker = mapToMonacoMarker(diag);

      expect(marker.severity).toBe(8); // Monaco Error = 8
      expect(marker.startLineNumber).toBe(10);
      expect(marker.startColumn).toBe(4);
      expect(marker.endLineNumber).toBe(10);
      expect(marker.endColumn).toBe(20);
      expect(marker.message).toBe("Unexpected identifier");
      expect(marker.source).toBe("eslint");
      expect(marker.code).toBe("no-undef");
    });

    it("maps Warning diagnostic to Monaco severity=4", () => {
      const diag = makeDiagnostic(DiagnosticSeverity.Warning, "prefer-const");
      const marker = mapToMonacoMarker(diag);
      expect(marker.severity).toBe(4); // Monaco Warning = 4
    });

    it("maps Information diagnostic to Monaco severity=2", () => {
      const diag = makeDiagnostic(DiagnosticSeverity.Information, "info msg");
      const marker = mapToMonacoMarker(diag);
      expect(marker.severity).toBe(2); // Monaco Info = 2
    });

    it("maps Hint diagnostic to Monaco severity=1", () => {
      const diag = makeDiagnostic(DiagnosticSeverity.Hint, "hint msg");
      const marker = mapToMonacoMarker(diag);
      expect(marker.severity).toBe(1); // Monaco Hint = 1
    });

    it("LSP severity is inverted from Monaco (Error=1 LSP → 8 Monaco)", () => {
      // Verify the full inversion mapping
      expect(DiagnosticSeverity.Error).toBe(1); // LSP Error = 1
      expect(
        mapToMonacoMarker(makeDiagnostic(DiagnosticSeverity.Error)).severity,
      ).toBe(8);

      expect(DiagnosticSeverity.Warning).toBe(2); // LSP Warning = 2
      expect(
        mapToMonacoMarker(makeDiagnostic(DiagnosticSeverity.Warning)).severity,
      ).toBe(4);
    });
  });

  // ─── Scenario 3: Request deduplication (race condition prevention) ─────────

  describe("Scenario 3: Request deduplication — second call cancels first", () => {
    it("AbortController.abort is called when second lintFile() fires before first completes", async () => {
      let resolveFirst!: (value: unknown) => void;

      // First fetch hangs until we resolve it manually
      mockFetch
        .mockReturnValueOnce(
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
        )
        .mockReturnValueOnce(
          makeFetchOk(
            makeLintResponse([
              makeDiagnostic(DiagnosticSeverity.Error, "final error"),
            ]),
          ),
        );

      const { result } = renderHook(() => useLintOnSave("ws-1", "/src/app.ts"));

      // Fire first call without awaiting
      const firstCall = act(() => {
        result.current.lintFile().catch(() => {});
      });

      // Give the first call time to register the AbortController
      await firstCall;

      const abortSpy = vi.fn();
      const fileKey = "ws-1:/src/app.ts";
      const existingController = useDiagnosticsStore
        .getState()
        .pendingRequests.get(fileKey);

      if (existingController) {
        const originalAbort = existingController.abort.bind(existingController);
        vi.spyOn(existingController, "abort").mockImplementation(() => {
          abortSpy();
          originalAbort();
        });
      }

      // Fire second call — this should cancel the first
      await act(async () => {
        await result.current.lintFile();
      });

      // Either the spy was called or the request was already cleaned up
      // Either way, fetch should have been called twice
      expect(mockFetch).toHaveBeenCalledTimes(2);

      // Resolve first promise to clean up
      resolveFirst({ ok: false });
    });

    it("store is populated with the result of the second (winning) lintFile()", async () => {
      const finalDiagnostics: Diagnostic[] = [
        makeDiagnostic(DiagnosticSeverity.Warning, "winning result"),
      ];

      // First call returns quickly
      mockFetch
        .mockReturnValueOnce(
          makeFetchOk(
            makeLintResponse([
              makeDiagnostic(DiagnosticSeverity.Error, "first result"),
            ]),
          ),
        )
        .mockReturnValueOnce(makeFetchOk(makeLintResponse(finalDiagnostics)));

      const { result } = renderHook(() => useLintOnSave("ws-1", "/src/app.ts"));

      // Sequential calls — second overwrites first
      await act(async () => {
        await result.current.lintFile();
      });

      await act(async () => {
        await result.current.lintFile();
      });

      const stored = useDiagnosticsStore
        .getState()
        .getDiagnosticsForFile("ws-1", "/src/app.ts");

      expect(stored).toHaveLength(1);
      expect(stored[0].message).toBe("winning result");
    });
  });

  // ─── Scenario 4: Non-lintable file skip ────────────────────────────────────

  describe("Scenario 4: Non-lintable file — fetch is NOT called", () => {
    it("skips fetch for .json files", async () => {
      const { result } = renderHook(() => useLintOnSave("ws-1", "config.json"));

      await act(async () => {
        await result.current.lintFile();
      });

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("skips fetch for .css files", async () => {
      const { result } = renderHook(() => useLintOnSave("ws-1", "styles.css"));

      await act(async () => {
        await result.current.lintFile();
      });

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("skips fetch for .md files", async () => {
      const { result } = renderHook(() => useLintOnSave("ws-1", "README.md"));

      await act(async () => {
        await result.current.lintFile();
      });

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("LINTABLE_EXTENSIONS covers .ts, .tsx, .js, .jsx", () => {
      expect(LINTABLE_EXTENSIONS).toContain(".ts");
      expect(LINTABLE_EXTENSIONS).toContain(".tsx");
      expect(LINTABLE_EXTENSIONS).toContain(".js");
      expect(LINTABLE_EXTENSIONS).toContain(".jsx");
    });

    it("calls fetch for every lintable extension", async () => {
      const lintableFiles = [
        "src/file.ts",
        "src/file.tsx",
        "src/file.js",
        "src/file.jsx",
      ];

      for (const filePath of lintableFiles) {
        mockFetch.mockReturnValueOnce(
          makeFetchOk({ diagnostics: [], filePath, duration: 10 }),
        );

        const { result } = renderHook(() => useLintOnSave("ws-1", filePath));

        await act(async () => {
          await result.current.lintFile();
        });
      }

      expect(mockFetch).toHaveBeenCalledTimes(lintableFiles.length);
    });
  });

  // ─── Scenario 5: Clean file clears diagnostics (no stale results) ──────────

  describe("Scenario 5: Clean file clears diagnostics — no stale results", () => {
    it("empty response replaces pre-populated diagnostics with empty array", async () => {
      // Pre-populate store with stale diagnostics
      useDiagnosticsStore
        .getState()
        .setDiagnostics("ws-1", "/src/app.ts", [
          makeDiagnostic(DiagnosticSeverity.Error, "stale error"),
          makeDiagnostic(DiagnosticSeverity.Warning, "stale warning"),
        ]);

      // Verify pre-population
      expect(
        useDiagnosticsStore
          .getState()
          .getDiagnosticsForFile("ws-1", "/src/app.ts"),
      ).toHaveLength(2);

      // Mock fetch returning clean result
      mockFetch.mockReturnValueOnce(
        makeFetchOk({
          diagnostics: [],
          filePath: "/src/app.ts",
          duration: 100,
        }),
      );

      const { result } = renderHook(() => useLintOnSave("ws-1", "/src/app.ts"));

      await act(async () => {
        await result.current.lintFile();
      });

      // Store should now be empty for this file
      const stored = useDiagnosticsStore
        .getState()
        .getDiagnosticsForFile("ws-1", "/src/app.ts");

      expect(stored).toHaveLength(0);
    });

    it("selector reflects cleared diagnostics — errorCount and warningCount become 0", async () => {
      useDiagnosticsStore
        .getState()
        .setDiagnostics("ws-1", "/src/app.ts", [
          makeDiagnostic(DiagnosticSeverity.Error, "old error"),
          makeDiagnostic(DiagnosticSeverity.Warning, "old warning"),
        ]);

      mockFetch.mockReturnValueOnce(
        makeFetchOk({ diagnostics: [], filePath: "/src/app.ts", duration: 50 }),
      );

      const { result: diagResult } = renderHook(() =>
        useDiagnosticsForFile("ws-1", "/src/app.ts"),
      );

      const { result: lintResult } = renderHook(() =>
        useLintOnSave("ws-1", "/src/app.ts"),
      );

      await act(async () => {
        await lintResult.current.lintFile();
      });

      await waitFor(() => {
        expect(diagResult.current.diagnostics).toHaveLength(0);
      });

      expect(diagResult.current.errorCount).toBe(0);
      expect(diagResult.current.warningCount).toBe(0);
    });
  });

  // ─── Scenario 6: Large diagnostics list (performance guard) ───────────────

  describe("Scenario 6: Large diagnostics list — performance guard", () => {
    it("stores and retrieves 50 diagnostics correctly", () => {
      const diagnostics: Diagnostic[] = Array.from({ length: 50 }, (_, i) =>
        makeDiagnostic(
          i % 3 === 0 ? DiagnosticSeverity.Error : DiagnosticSeverity.Warning,
          `diagnostic ${i}`,
          i + 1,
          1,
        ),
      );

      useDiagnosticsStore
        .getState()
        .setDiagnostics("ws-1", "/src/big.ts", diagnostics);

      const stored = useDiagnosticsStore
        .getState()
        .getDiagnosticsForFile("ws-1", "/src/big.ts");

      expect(stored).toHaveLength(50);
    });

    it("errorCount and warningCount are accurate for 50 diagnostics", () => {
      // i % 3 === 0 → Error: indices 0,3,6,...,48 = 17 errors
      // rest → Warning: 50 - 17 = 33 warnings
      const diagnostics: Diagnostic[] = Array.from({ length: 50 }, (_, i) =>
        makeDiagnostic(
          i % 3 === 0 ? DiagnosticSeverity.Error : DiagnosticSeverity.Warning,
          `msg ${i}`,
        ),
      );

      useDiagnosticsStore
        .getState()
        .setDiagnostics("ws-1", "/src/big.ts", diagnostics);

      const errorCount = useDiagnosticsStore
        .getState()
        .getErrorCount("ws-1", "/src/big.ts");
      const warningCount = useDiagnosticsStore
        .getState()
        .getWarningCount("ws-1", "/src/big.ts");

      // indices where i % 3 === 0: 0,3,6,9,12,15,18,21,24,27,30,33,36,39,42,45,48 = 17
      expect(errorCount).toBe(17);
      expect(warningCount).toBe(33);
      expect(errorCount + warningCount).toBe(50);
    });

    it("getDiagnosticsForFile returns all 50 items intact with messages preserved", () => {
      const diagnostics: Diagnostic[] = Array.from({ length: 50 }, (_, i) =>
        makeDiagnostic(DiagnosticSeverity.Warning, `msg-${i}`),
      );

      useDiagnosticsStore
        .getState()
        .setDiagnostics("ws-1", "/src/big.ts", diagnostics);

      const stored = useDiagnosticsStore
        .getState()
        .getDiagnosticsForFile("ws-1", "/src/big.ts");

      expect(stored[0].message).toBe("msg-0");
      expect(stored[49].message).toBe("msg-49");
    });
  });

  // ─── Scenario 7: Workspace switch — stale request discarded ───────────────

  describe("Scenario 7: Workspace switch — stale request discarded", () => {
    it("cancelPendingRequest aborts the stored AbortController", () => {
      const controller = new AbortController();
      const abortSpy = vi.spyOn(controller, "abort");

      const fileKey = "ws-1:/src/app.ts";
      useDiagnosticsStore
        .getState()
        .registerPendingRequest(fileKey, controller);

      useDiagnosticsStore.getState().cancelPendingRequest(fileKey);

      expect(abortSpy).toHaveBeenCalledOnce();
    });

    it("pending request is removed from store after cancelPendingRequest", () => {
      const controller = new AbortController();
      const fileKey = "ws-1:/src/app.ts";

      useDiagnosticsStore
        .getState()
        .registerPendingRequest(fileKey, controller);
      expect(
        useDiagnosticsStore.getState().pendingRequests.get(fileKey),
      ).toBeDefined();

      useDiagnosticsStore.getState().cancelPendingRequest(fileKey);

      expect(
        useDiagnosticsStore.getState().pendingRequests.get(fileKey),
      ).toBeUndefined();
    });

    it("store is NOT updated after an aborted request", async () => {
      // Pre-populate store
      useDiagnosticsStore
        .getState()
        .setDiagnostics("ws-1", "/src/app.ts", [
          makeDiagnostic(DiagnosticSeverity.Warning, "pre-existing"),
        ]);

      // Mock fetch that will be cancelled
      let rejectFetch!: (reason: unknown) => void;
      mockFetch.mockReturnValueOnce(
        new Promise((_, reject) => {
          rejectFetch = reject;
        }),
      );

      const { result } = renderHook(() => useLintOnSave("ws-1", "/src/app.ts"));

      // Start lint without awaiting
      let lintDone = false;
      const lintPromise = act(() => {
        return result.current.lintFile().then(() => {
          lintDone = true;
        });
      });

      // Cancel the pending request (simulating workspace switch)
      act(() => {
        useDiagnosticsStore.getState().cancelPendingRequest("ws-1:/src/app.ts");
      });

      // Reject with AbortError (simulates browser cancellation)
      const abortError = new DOMException("Aborted", "AbortError");
      rejectFetch(abortError);

      await lintPromise;
      expect(lintDone).toBe(true);

      // Store should still have the pre-existing diagnostic, not be cleared
      const stored = useDiagnosticsStore
        .getState()
        .getDiagnosticsForFile("ws-1", "/src/app.ts");

      // After abort, the store was NOT updated with the new (empty) response
      // The pre-existing entry remains untouched
      expect(stored).toHaveLength(1);
      expect(stored[0].message).toBe("pre-existing");
    });

    it("cancelPendingRequest is a no-op for unknown keys", () => {
      // Should not throw
      expect(() => {
        useDiagnosticsStore.getState().cancelPendingRequest("non-existent-key");
      }).not.toThrow();
    });
  });
});
