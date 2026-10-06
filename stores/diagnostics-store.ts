import { create } from "zustand";
import { type Diagnostic, DiagnosticSeverity } from "@/types/diagnostics";

export type DiagnosticSourceKey = "eslint" | "typescript";

type DiagnosticsBySourceEntry = Partial<
  Record<DiagnosticSourceKey, Diagnostic[]>
>;

interface DiagnosticsMaps {
  diagnosticsByFile: Map<string, Diagnostic[]>;
  diagnosticsBySource: Map<string, DiagnosticsBySourceEntry>;
}

function fileKey(workspaceId: string, filePath: string): string {
  return `${workspaceId}:${filePath}`;
}

// ESLint first, then TypeScript. Reuses the single non-empty source array
// so callers that only use one source keep a stable reference.
function mergeSourceDiagnostics(entry: DiagnosticsBySourceEntry): Diagnostic[] {
  const eslintDiagnostics = entry.eslint ?? [];
  const typescriptDiagnostics = entry.typescript ?? [];
  if (typescriptDiagnostics.length === 0) return eslintDiagnostics;
  if (eslintDiagnostics.length === 0) return typescriptDiagnostics;
  return [...eslintDiagnostics, ...typescriptDiagnostics];
}

function withSourceDiagnostics(
  entry: DiagnosticsBySourceEntry | undefined,
  source: DiagnosticSourceKey,
  diagnostics: Diagnostic[],
): DiagnosticsBySourceEntry {
  const nextEntry: DiagnosticsBySourceEntry = { ...entry };
  if (diagnostics.length > 0) {
    nextEntry[source] = diagnostics;
  } else {
    delete nextEntry[source];
  }
  return nextEntry;
}

// Mutates the given (already copied) maps for a single file key.
function writeEntry(
  maps: DiagnosticsMaps,
  key: string,
  entry: DiagnosticsBySourceEntry,
): void {
  const mergedDiagnostics = mergeSourceDiagnostics(entry);
  if (mergedDiagnostics.length === 0) {
    maps.diagnosticsBySource.delete(key);
    maps.diagnosticsByFile.delete(key);
    return;
  }
  maps.diagnosticsBySource.set(key, entry);
  maps.diagnosticsByFile.set(key, mergedDiagnostics);
}

function copyMaps(state: DiagnosticsMaps): DiagnosticsMaps {
  return {
    diagnosticsByFile: new Map(state.diagnosticsByFile),
    diagnosticsBySource: new Map(state.diagnosticsBySource),
  };
}

interface DiagnosticsState extends DiagnosticsMaps {
  pendingRequests: Map<string, AbortController>;
  setDiagnostics: (
    workspaceId: string,
    filePath: string,
    diagnostics: Diagnostic[],
  ) => void;
  setDiagnosticsForSource: (
    workspaceId: string,
    filePath: string,
    source: DiagnosticSourceKey,
    diagnostics: Diagnostic[],
  ) => void;
  clearDiagnostics: (workspaceId: string, filePath: string) => void;
  clearDiagnosticsForSource: (
    workspaceId: string,
    filePath: string,
    source: DiagnosticSourceKey,
  ) => void;
  clearSourceForWorkspace: (
    workspaceId: string,
    source: DiagnosticSourceKey,
  ) => void;
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
  diagnosticsBySource: new Map(),
  pendingRequests: new Map(),

  setDiagnostics: (workspaceId, filePath, diagnostics) => {
    get().setDiagnosticsForSource(workspaceId, filePath, "eslint", diagnostics);
  },

  setDiagnosticsForSource: (workspaceId, filePath, source, diagnostics) => {
    set((state) => {
      const key = fileKey(workspaceId, filePath);
      const maps = copyMaps(state);
      const nextEntry = withSourceDiagnostics(
        state.diagnosticsBySource.get(key),
        source,
        diagnostics,
      );
      writeEntry(maps, key, nextEntry);
      return maps;
    });
  },

  clearDiagnostics: (workspaceId, filePath) => {
    set((state) => {
      const key = fileKey(workspaceId, filePath);
      const maps = copyMaps(state);
      writeEntry(maps, key, {});
      return maps;
    });
  },

  clearDiagnosticsForSource: (workspaceId, filePath, source) => {
    get().setDiagnosticsForSource(workspaceId, filePath, source, []);
  },

  clearSourceForWorkspace: (workspaceId, source) => {
    set((state) => {
      const workspacePrefix = `${workspaceId}:`;
      const maps = copyMaps(state);
      for (const [key, entry] of state.diagnosticsBySource) {
        if (!key.startsWith(workspacePrefix) || !entry[source]) continue;
        writeEntry(maps, key, withSourceDiagnostics(entry, source, []));
      }
      return maps;
    });
  },

  clearAllDiagnostics: () => {
    set({ diagnosticsByFile: new Map(), diagnosticsBySource: new Map() });
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
