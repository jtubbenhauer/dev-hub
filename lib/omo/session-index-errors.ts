export class OmoSessionIdentityConflictError extends Error {
  readonly workspaceId: string;
  readonly durableId: string;
  readonly sessionPath: string;

  constructor(workspaceId: string, durableId: string, sessionPath: string) {
    super(
      `OMO session path ${sessionPath} is already assigned in workspace ${workspaceId}`,
    );
    this.name = "OmoSessionIdentityConflictError";
    this.workspaceId = workspaceId;
    this.durableId = durableId;
    this.sessionPath = sessionPath;
  }
}

export function translateOmoSessionIndexError(
  error: unknown,
  workspaceId: string,
  durableId: string,
  sessionPath: string | null,
): never {
  if (error instanceof OmoSessionIdentityConflictError) throw error;
  if (
    sessionPath !== null &&
    error instanceof Error &&
    error.message.includes("omo_session_index.workspace_id") &&
    error.message.includes("omo_session_index.session_path")
  ) {
    throw new OmoSessionIdentityConflictError(
      workspaceId,
      durableId,
      sessionPath,
    );
  }
  throw error;
}
