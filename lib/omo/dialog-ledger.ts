import type { PermissionRequest, QuestionRequest } from "@opencode-ai/sdk/v2";

export const DIALOG_TTL_MS = 24 * 60 * 60 * 1_000;

export type DialogMethod =
  | "question"
  | "select"
  | "confirm"
  | "input"
  | "editor";

export type DialogLedgerEntry = {
  readonly publicId: string;
  readonly routingHandle: string;
  readonly durableId: string;
  readonly workspaceId: string;
  readonly extUiId: string;
  readonly upstreamRequestId?: string;
  readonly method: DialogMethod;
  readonly payload: QuestionRequest;
  readonly upstreamQuestionIds: readonly string[];
  readonly createdAt: number;
};

export type RegisterDialogInput = {
  readonly routingHandle: string;
  readonly durableId: string;
  readonly workspaceId: string;
  readonly extUiId: string;
  readonly upstreamRequestId?: string;
  readonly method: DialogMethod;
  readonly request: Omit<QuestionRequest, "id">;
  readonly upstreamQuestionIds?: readonly string[];
};

export type PermissionLedgerEntry = {
  readonly publicId: string;
  readonly routingHandle: string;
  readonly durableId: string;
  readonly workspaceId: string;
  readonly extUiId: string;
  readonly payload: PermissionRequest;
  readonly createdAt: number;
};

export type RegisterPermissionInput = {
  readonly routingHandle: string;
  readonly durableId: string;
  readonly workspaceId: string;
  readonly extUiId: string;
  readonly request: Omit<PermissionRequest, "id">;
};

type DialogLedgerOptions = {
  readonly now: () => number;
};

export class DialogLedger {
  private readonly entries = new Map<string, DialogLedgerEntry>();
  private readonly permissions = new Map<string, PermissionLedgerEntry>();
  private readonly now: () => number;

  constructor(options?: DialogLedgerOptions) {
    this.now = options?.now ?? Date.now;
  }

  register(input: RegisterDialogInput): DialogLedgerEntry {
    this.pruneExpired();
    const existing = this.findByUpstream(input.routingHandle, input.extUiId);
    if (existing) return existing;

    const publicId = this.createPublicId();
    const payload = {
      ...input.request,
      id: publicId,
    } satisfies QuestionRequest;
    const entry = {
      publicId,
      routingHandle: input.routingHandle,
      durableId: input.durableId,
      workspaceId: input.workspaceId,
      extUiId: input.extUiId,
      ...(input.upstreamRequestId === undefined
        ? {}
        : { upstreamRequestId: input.upstreamRequestId }),
      method: input.method,
      payload,
      upstreamQuestionIds: input.upstreamQuestionIds ?? [],
      createdAt: this.now(),
    } satisfies DialogLedgerEntry;
    this.entries.set(publicId, entry);
    return entry;
  }

  find(publicId: string): DialogLedgerEntry | undefined {
    this.pruneExpired();
    return this.entries.get(publicId);
  }

  resolve(publicId: string): DialogLedgerEntry | undefined {
    const entry = this.find(publicId);
    if (entry) this.entries.delete(publicId);
    return entry;
  }

  resolveUpstream(
    routingHandle: string,
    extUiId: string,
  ): DialogLedgerEntry | undefined {
    this.pruneExpired();
    const entry = this.findByUpstream(routingHandle, extUiId);
    if (entry) this.entries.delete(entry.publicId);
    return entry;
  }

  requestsForWorkspace(workspaceId: string): QuestionRequest[] {
    this.pruneExpired();
    return [...this.entries.values()]
      .filter((entry) => entry.workspaceId === workspaceId)
      .map((entry) => entry.payload);
  }

  removeByRoutingHandle(routingHandle: string): void {
    this.pruneExpired();
    for (const [publicId, entry] of this.entries) {
      if (entry.routingHandle === routingHandle) this.entries.delete(publicId);
    }
  }

  registerPermission(input: RegisterPermissionInput): PermissionLedgerEntry {
    this.pruneExpired();
    const existing = [...this.permissions.values()].find(
      (entry) =>
        entry.routingHandle === input.routingHandle &&
        entry.extUiId === input.extUiId,
    );
    if (existing) return existing;
    const publicId = this.createPublicId("dh_p_");
    const entry = {
      publicId,
      routingHandle: input.routingHandle,
      durableId: input.durableId,
      workspaceId: input.workspaceId,
      extUiId: input.extUiId,
      payload: {
        ...input.request,
        id: publicId,
      } satisfies PermissionRequest,
      createdAt: this.now(),
    } satisfies PermissionLedgerEntry;
    this.permissions.set(publicId, entry);
    return entry;
  }

  findPermission(publicId: string): PermissionLedgerEntry | undefined {
    this.pruneExpired();
    return this.permissions.get(publicId);
  }

  resolvePermission(publicId: string): PermissionLedgerEntry | undefined {
    const entry = this.findPermission(publicId);
    if (entry) this.permissions.delete(publicId);
    return entry;
  }

  permissionsForWorkspace(workspaceId: string): PermissionRequest[] {
    this.pruneExpired();
    return [...this.permissions.values()]
      .filter((entry) => entry.workspaceId === workspaceId)
      .map((entry) => entry.payload);
  }

  removePermissionsByRoutingHandle(
    routingHandle: string,
  ): PermissionLedgerEntry[] {
    this.pruneExpired();
    const removed = [...this.permissions.values()].filter(
      (entry) => entry.routingHandle === routingHandle,
    );
    for (const entry of removed) this.permissions.delete(entry.publicId);
    return removed;
  }

  rekeyForSuccessor(oldRaw: string, newRaw: string): QuestionRequest[] {
    this.pruneExpired();
    const rebuilt: QuestionRequest[] = [];
    for (const [oldPublicId, entry] of [...this.entries]) {
      if (entry.durableId !== oldRaw) continue;
      this.entries.delete(oldPublicId);
      const publicId = this.createPublicId();
      const payload = {
        ...entry.payload,
        id: publicId,
        sessionID: `omo_${newRaw}`,
      } satisfies QuestionRequest;
      this.entries.set(publicId, {
        ...entry,
        publicId,
        durableId: newRaw,
        payload,
      });
      rebuilt.push(payload);
    }
    return rebuilt;
  }

  clear(): void {
    this.entries.clear();
    this.permissions.clear();
  }

  private findByUpstream(
    routingHandle: string,
    extUiId: string,
  ): DialogLedgerEntry | undefined {
    return [...this.entries.values()].find(
      (entry) =>
        entry.routingHandle === routingHandle && entry.extUiId === extUiId,
    );
  }

  private createPublicId(prefix = "dh_q_"): string {
    let publicId = `${prefix}${crypto.randomUUID()}`;
    while (this.entries.has(publicId) || this.permissions.has(publicId)) {
      publicId = `${prefix}${crypto.randomUUID()}`;
    }
    return publicId;
  }

  private pruneExpired(): void {
    const cutoff = this.now() - DIALOG_TTL_MS;
    for (const [publicId, entry] of this.entries) {
      if (entry.createdAt <= cutoff) this.entries.delete(publicId);
    }
    for (const [publicId, entry] of this.permissions) {
      if (entry.createdAt <= cutoff) this.permissions.delete(publicId);
    }
  }
}
