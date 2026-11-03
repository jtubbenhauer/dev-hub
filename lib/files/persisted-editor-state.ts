export type DiffViewMode = "unified" | "side-by-side";

export interface WorkspaceFileState {
  readonly expandedPaths: readonly string[];
}

export interface PersistedEditorState {
  readonly diffViewMode: DiffViewMode;
  readonly workspaceFileStates: Readonly<Record<string, WorkspaceFileState>>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDiffViewMode(value: unknown): value is DiffViewMode {
  return value === "unified" || value === "side-by-side";
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function readWorkspaceFileState(value: unknown): WorkspaceFileState | null {
  if (!isRecord(value) || !Array.isArray(value.expandedPaths)) return null;
  return { expandedPaths: value.expandedPaths.filter(isString) };
}

// Older versions also saved each workspace's file tabs. The workbench layout
// owns tabs now, so only the expanded folders and the diff view mode carry over.
export function migratePersistedEditorState(
  persisted: unknown,
): PersistedEditorState {
  const saved = isRecord(persisted) ? persisted : {};
  const savedWorkspaceStates = isRecord(saved.workspaceFileStates)
    ? saved.workspaceFileStates
    : {};
  return {
    diffViewMode: isDiffViewMode(saved.diffViewMode)
      ? saved.diffViewMode
      : "unified",
    workspaceFileStates: Object.fromEntries(
      Object.entries(savedWorkspaceStates).flatMap(([workspaceId, value]) => {
        const workspaceFileState = readWorkspaceFileState(value);
        return workspaceFileState
          ? [[workspaceId, workspaceFileState] as const]
          : [];
      }),
    ),
  };
}
