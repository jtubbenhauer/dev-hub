import { create } from "zustand";
import { type Diagnostic, DiagnosticSeverity } from "@/types/diagnostics";

function fileKey(workspaceId: string, filePath: string): string {
  return `${workspaceId}:${filePath}`;
}

interface DiagnosticsState {
  diagnosticsByFile: Map<string, Diagnostic[]>;
  pendingRequests: Map<string, AbortController>;
  setDiagnostics: (
    workspaceId: string,
    filePath: string,
    diagnostics: Diagnostic[],
  ) => void;
  clearDiagnostics: (workspaceId: string, filePath: string) => void;
  clearAllDiagnostics: () => void;
  registerPendingRequest: (key: string, controller: AbortController) => void;
  cancelPendingRequest: (key: string) => void;
  getDiagnosticsForFile: (
    workspaceId: string,
    filePath: string,
  ) => Diagnostic[];
  getErrorCount: (workspaceId: string, filePath: string) => number;
  getWarningCount: (workspaceId: string, filePath: string) => number;
}

export const useDiagnosticsStore = create<DiagnosticsState>()((set, get) => ({
  diagnosticsByFile: new Map(),
  pendingRequests: new Map(),

  setDiagnostics: (workspaceId, filePath, diagnostics) => {
    set((state) => ({
      diagnosticsByFile: new Map(state.diagnosticsByFile).set(
        fileKey(workspaceId, filePath),
        diagnostics,
      ),
    }));
  },

  clearDiagnostics: (workspaceId, filePath) => {
    set((state) => {
      const next = new Map(state.diagnosticsByFile);
      next.delete(fileKey(workspaceId, filePath));
      return { diagnosticsByFile: next };
    });
  },

  clearAllDiagnostics: () => {
    set({ diagnosticsByFile: new Map() });
  },

  registerPendingRequest: (key, controller) => {
    set((state) => ({
      pendingRequests: new Map(state.pendingRequests).set(key, controller),
    }));
  },

  cancelPendingRequest: (key) => {
    const controller = get().pendingRequests.get(key);
    if (controller) {
      controller.abort();
      set((state) => {
        const next = new Map(state.pendingRequests);
        next.delete(key);
        return { pendingRequests: next };
      });
    }
  },

  getDiagnosticsForFile: (workspaceId, filePath) => {
    return get().diagnosticsByFile.get(fileKey(workspaceId, filePath)) ?? [];
  },

  getErrorCount: (workspaceId, filePath) => {
    return get()
      .getDiagnosticsForFile(workspaceId, filePath)
      .filter((d) => d.severity === DiagnosticSeverity.Error).length;
  },

  getWarningCount: (workspaceId, filePath) => {
    return get()
      .getDiagnosticsForFile(workspaceId, filePath)
      .filter((d) => d.severity === DiagnosticSeverity.Warning).length;
  },
}));
