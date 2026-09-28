import { and, eq } from "drizzle-orm";
import { realpath } from "node:fs/promises";
import { omoSessionIndex } from "@/drizzle/schema";
import { db } from "@/lib/db";
import type { JsonlRecord } from "@/lib/omo/jsonl";
import type { OmoRpcClient } from "@/lib/omo/rpc-client";
import {
  getOmoIndexRow,
  upsertOmoSessionIndexAuthoritative,
  type OmoAuthoritativeSessionRow,
  type OmoSessionIndexRow,
} from "@/lib/omo/session-index";
import { isJsonObject } from "@/lib/omo/session-registry-records";
import type { OmoSessionRegistryWorkspace } from "@/lib/omo/session-registry-types";

export async function getOmoIndexRowByPath(
  workspaceId: string,
  sessionPath: string,
): Promise<OmoSessionIndexRow | null> {
  return (
    (
      await db
        .select()
        .from(omoSessionIndex)
        .where(
          and(
            eq(omoSessionIndex.workspaceId, workspaceId),
            eq(omoSessionIndex.sessionPath, sessionPath),
          ),
        )
        .limit(1)
    )[0] ?? null
  );
}

export function canonicalWorkspacePath(
  workspace: OmoSessionRegistryWorkspace,
): Promise<string> {
  return realpath(workspace.path);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function sessionRows(response: JsonlRecord): readonly JsonlRecord[] {
  const data = response["data"];
  if (!isJsonObject(data) || !Array.isArray(data["sessions"])) {
    throw new TypeError("Invalid OmO list_sessions response");
  }
  return data["sessions"].filter(isJsonObject);
}

async function authoritativeRow(
  workspace: OmoSessionRegistryWorkspace,
  canonicalPath: string,
  row: JsonlRecord,
): Promise<OmoAuthoritativeSessionRow | null> {
  const durableId = optionalString(row["durableSessionId"]);
  const cwd = optionalString(row["cwd"]);
  const kind = row["kind"];
  if (
    durableId === undefined ||
    cwd === undefined ||
    (cwd !== workspace.path && cwd !== canonicalPath) ||
    (kind !== "interactive" && kind !== "worker")
  ) {
    return null;
  }
  const existing = await getOmoIndexRow(workspace.id, durableId);
  const now = Date.now();
  return {
    durableId,
    sessionPath: optionalString(row["sessionPath"]) ?? null,
    kind,
    context: row["context"] ?? {},
    title: optionalString(row["name"]) ?? existing?.title ?? "Untitled",
    createdMs: existing?.createdMs ?? now,
    updatedMs: existing?.updatedMs ?? now,
  };
}

export async function refreshOmoIndexFromHost(
  client: OmoRpcClient,
  workspace: OmoSessionRegistryWorkspace,
  canonicalPath: string,
): Promise<void> {
  const response = await client.request({
    type: "list_sessions",
    include_workers: true,
  });
  const rows = await Promise.all(
    sessionRows(response).map((row) =>
      authoritativeRow(workspace, canonicalPath, row),
    ),
  );
  const authoritative = rows.filter(
    (row): row is OmoAuthoritativeSessionRow => row !== null,
  );
  if (authoritative.length > 0) {
    await upsertOmoSessionIndexAuthoritative(workspace.id, authoritative);
  }
}
