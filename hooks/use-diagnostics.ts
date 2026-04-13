"use client";

import { useState, useCallback } from "react";
import { useDiagnosticsStore } from "@/stores/diagnostics-store";
import { LINTABLE_EXTENSIONS } from "@/lib/editor/diagnostics";
import {
  DiagnosticSeverity,
  type LintResponse,
  type Diagnostic,
} from "@/types/diagnostics";

const EMPTY_DIAGNOSTICS: Diagnostic[] = [];

export function useLintOnSave(
  workspaceId: string | undefined,
  filePath: string | undefined,
): { lintFile: () => Promise<void>; isLinting: boolean } {
  const [isLinting, setIsLinting] = useState(false);

  const lintFile = useCallback(async () => {
    if (!workspaceId || !filePath) return;

    const isLintable = LINTABLE_EXTENSIONS.some((ext) =>
      filePath.endsWith(ext),
    );
    if (!isLintable) return;

    const fileKey = `${workspaceId}:${filePath}`;

    useDiagnosticsStore.getState().cancelPendingRequest(fileKey);

    const controller = new AbortController();
    useDiagnosticsStore.getState().registerPendingRequest(fileKey, controller);

    setIsLinting(true);
    try {
      const res = await fetch("/api/files/lint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, filePath }),
        signal: controller.signal,
      });
      if (res.ok) {
        const data = (await res.json()) as LintResponse;
        useDiagnosticsStore
          .getState()
          .setDiagnostics(workspaceId, filePath, data.diagnostics);
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        // silent — request was cancelled
        return;
      }
      console.error("[useLintOnSave] lint failed:", error);
    } finally {
      setIsLinting(false);
      useDiagnosticsStore.getState().cancelPendingRequest(fileKey);
    }
  }, [workspaceId, filePath]);

  return { lintFile, isLinting };
}

export function useDiagnosticsForFile(
  workspaceId: string | undefined,
  filePath: string | undefined,
): { diagnostics: Diagnostic[]; errorCount: number; warningCount: number } {
  const diagnostics = useDiagnosticsStore((s) => {
    if (!workspaceId || !filePath) return EMPTY_DIAGNOSTICS;
    return (
      s.diagnosticsByFile.get(`${workspaceId}:${filePath}`) ?? EMPTY_DIAGNOSTICS
    );
  });
  const errorCount = useDiagnosticsStore((s) => {
    if (!workspaceId || !filePath) return 0;
    return (
      s.diagnosticsByFile.get(`${workspaceId}:${filePath}`) ?? EMPTY_DIAGNOSTICS
    ).filter((d) => d.severity === DiagnosticSeverity.Error).length;
  });
  const warningCount = useDiagnosticsStore((s) => {
    if (!workspaceId || !filePath) return 0;
    return (
      s.diagnosticsByFile.get(`${workspaceId}:${filePath}`) ?? EMPTY_DIAGNOSTICS
    ).filter((d) => d.severity === DiagnosticSeverity.Warning).length;
  });

  return { diagnostics, errorCount, warningCount };
}
