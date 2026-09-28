export class OmoCorruptIndexRowError extends Error {
  readonly name = "OmoCorruptIndexRowError";

  constructor(
    readonly workspaceId: string,
    readonly durableId: string,
  ) {
    super(
      `OmO session ${durableId} in workspace ${workspaceId} has invalid authoritative context`,
    );
  }
}

export class OmoSessionReplacedError extends Error {
  readonly name = "OmoSessionReplacedError";

  constructor(readonly newDurableId: string) {
    super(`The OmO session was replaced by ${newDurableId}`);
  }
}

export class OmoWorkspacePathConflictError extends Error {
  readonly name = "OmoWorkspacePathConflictError";

  constructor(
    readonly canonicalWorkspacePath: string,
    readonly owningWorkspaceId: string,
    readonly requestedWorkspaceId: string,
  ) {
    super(
      `Workspace path ${canonicalWorkspacePath} is already owned by ${owningWorkspaceId}`,
    );
  }
}

export class OmoHydrationOverflowError extends Error {
  readonly name = "OmoHydrationOverflowError";

  constructor(readonly durableId: string) {
    super(`OmO session ${durableId} overflowed all hydration fences`);
  }
}

export class OmoHydrationAbortedError extends Error {
  readonly name = "OmoHydrationAbortedError";

  constructor(readonly durableId: string) {
    super(`OmO session ${durableId} hydration was aborted before it completed`);
  }
}

export class OmoEngineUnavailableError extends Error {
  readonly name = "OmoEngineUnavailableError";
  readonly code = "engine_unavailable";
  readonly statusCode = 503;

  constructor(
    readonly command: string,
    readonly detail: string,
  ) {
    super(`OmO engine unavailable while handling ${command}: ${detail}`);
  }
}
