import { db } from "@/lib/db";
import { workspaces } from "@/drizzle/schema";
import { eq } from "drizzle-orm";
import { readSshConfig, resolveSshAlias } from "@/lib/ssh-config";

type WorkspaceRow = typeof workspaces.$inferSelect;

function readStringField(
  meta: Record<string, unknown> | null,
  key: string,
): string | null {
  const value = meta?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

export function getSshMatchKeys(row: WorkspaceRow): string[] {
  const meta = asRecord(row.providerMeta);
  const containerId = readStringField(meta, "containerId");
  const providerWorkspaceId = readStringField(meta, "providerWorkspaceId");
  return [containerId, providerWorkspaceId, row.name].filter(
    (key): key is string => key !== null,
  );
}

export function getSshHost(row: WorkspaceRow): string | null {
  const meta = asRecord(row.providerMeta);
  const host = readStringField(meta, "host");
  if (host) return host;

  // Fall back to the agent's hostname when the provider did not record a host.
  if (!row.agentUrl) return null;
  try {
    return new URL(row.agentUrl).hostname || null;
  } catch {
    return null;
  }
}

function needsBackfill(row: WorkspaceRow): boolean {
  return row.backend === "remote" && !row.sshTarget;
}

// Derives the Remote-SSH alias for remote workspaces that do not have one yet
// and persists it, so pre-existing workspaces pick it up without user action.
export async function backfillSshTargets(
  rows: WorkspaceRow[],
): Promise<WorkspaceRow[]> {
  const pending = rows.filter(needsBackfill);
  if (pending.length === 0) return rows;

  const entries = await readSshConfig();
  if (entries.length === 0) return rows;

  const resolvedById = new Map<string, string>();

  for (const row of pending) {
    const host = getSshHost(row);
    if (!host) continue;

    const result = resolveSshAlias(entries, host, getSshMatchKeys(row));
    if (result.kind !== "resolved") continue;

    resolvedById.set(row.id, result.alias);
  }

  if (resolvedById.size === 0) return rows;

  await Promise.all(
    [...resolvedById.entries()].map(([id, alias]) =>
      db
        .update(workspaces)
        .set({ sshTarget: alias })
        .where(eq(workspaces.id, id)),
    ),
  );

  return rows.map((row) => {
    const alias = resolvedById.get(row.id);
    return alias ? { ...row, sshTarget: alias } : row;
  });
}
