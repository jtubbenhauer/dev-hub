import type { LiveAdapterSeed } from "@/lib/omo/adapter/live-adapter-types";
import type { JsonlRecord } from "@/lib/omo/jsonl";
import type { OmoOpenedSession } from "@/lib/omo/rpc-client";

export type OmoOpenedState = {
  readonly durableId: string;
  readonly sessionPath: string | null;
  readonly title: string;
  readonly isStreaming: boolean;
  readonly modelId: string | undefined;
  readonly providerId: string | undefined;
  readonly record: JsonlRecord;
};

export type OmoHydrationEntry = {
  readonly id: string;
  readonly parentId: string | null;
  readonly type: string;
  readonly record: JsonlRecord;
};

export type OmoEntriesSnapshot = {
  readonly entries: readonly OmoHydrationEntry[];
  readonly leafId: string | null;
};

export function isJsonObject(value: unknown): value is JsonlRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function parseOpenedState(opened: OmoOpenedSession): OmoOpenedState {
  const state = opened["state"];
  if (!isJsonObject(state) || typeof state["sessionId"] !== "string") {
    throw new TypeError("Invalid OmO open_session state");
  }
  const model = isJsonObject(state["model"]) ? state["model"] : undefined;
  return {
    durableId: state["sessionId"],
    sessionPath: optionalString(state["sessionFile"]) ?? null,
    title: optionalString(state["sessionName"]) ?? "Untitled",
    isStreaming: state["isStreaming"] === true,
    modelId:
      optionalString(model?.["id"]) ?? optionalString(model?.["modelId"]),
    providerId:
      optionalString(model?.["provider"]) ??
      optionalString(model?.["providerId"]),
    record: state,
  };
}

export function parseEntriesSnapshot(
  response: JsonlRecord,
): OmoEntriesSnapshot {
  const data = response["data"];
  if (!isJsonObject(data) || !Array.isArray(data["entries"])) {
    throw new TypeError("Invalid OmO get_entries response");
  }
  const leafId = data["leafId"];
  if (leafId !== null && typeof leafId !== "string") {
    throw new TypeError("Invalid OmO get_entries leaf");
  }
  const entries: OmoHydrationEntry[] = [];
  for (const value of data["entries"]) {
    if (
      !isJsonObject(value) ||
      typeof value["id"] !== "string" ||
      typeof value["type"] !== "string"
    ) {
      continue;
    }
    const parentId = value["parentId"];
    entries.push({
      id: value["id"],
      parentId: typeof parentId === "string" ? parentId : null,
      type: value["type"],
      record: value,
    });
  }
  return { entries, leafId };
}

export function activeHydrationBranch(
  entries: readonly OmoHydrationEntry[],
  leafId: string | null,
): readonly OmoHydrationEntry[] {
  if (leafId === null) return [];
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const branch: OmoHydrationEntry[] = [];
  const visited = new Set<string>();
  let currentId: string | null = leafId;
  while (currentId !== null && !visited.has(currentId)) {
    visited.add(currentId);
    const entry = byId.get(currentId);
    if (entry === undefined) break;
    branch.push(entry);
    currentId = entry.parentId;
  }
  return branch.reverse();
}

function appendedEntryId(record: JsonlRecord): string | undefined {
  if (record["type"] !== "entry_appended") return undefined;
  const entry = record["entry"];
  return isJsonObject(entry) ? optionalString(entry["id"]) : undefined;
}

function messageRole(entry: OmoHydrationEntry): string | undefined {
  const message = entry.record["message"];
  return isJsonObject(message) ? optionalString(message["role"]) : undefined;
}

export function adapterSeedForReplay(
  branch: readonly OmoHydrationEntry[],
  buffered: readonly JsonlRecord[],
  opened: OmoOpenedState,
): LiveAdapterSeed {
  const branchIds = new Set(branch.map((entry) => entry.id));
  const earliestBufferedId = buffered
    .map(appendedEntryId)
    .find((entryId) => entryId !== undefined && branchIds.has(entryId));
  const seedEnd =
    earliestBufferedId === undefined
      ? branch.length
      : Math.max(
          0,
          branch.findIndex((entry) => entry.id === earliestBufferedId),
        );
  let lastUserMessageID: string | undefined;
  let lastKnownModel = opened.modelId;
  let lastKnownProvider = opened.providerId;
  for (const entry of branch.slice(0, seedEnd)) {
    if (entry.type === "message" && messageRole(entry) === "user") {
      lastUserMessageID = `omo_${entry.id}`;
    }
    if (entry.type === "model_change") {
      lastKnownModel = optionalString(entry.record["modelId"]);
      lastKnownProvider = optionalString(entry.record["provider"]);
    }
  }
  return {
    ...(lastUserMessageID ? { lastUserMessageID } : {}),
    ...(lastKnownModel ? { lastKnownModel } : {}),
    ...(lastKnownProvider ? { lastKnownProvider } : {}),
  };
}

export function rootUserEntryId(
  entries: readonly OmoHydrationEntry[],
): string | undefined {
  return entries.find(
    (entry) =>
      entry.parentId === null &&
      entry.type === "message" &&
      messageRole(entry) === "user",
  )?.id;
}

export function isEntryAncestor(
  entries: readonly OmoHydrationEntry[],
  ancestorId: string,
  leafId: string | null,
): boolean {
  return activeHydrationBranch(entries, leafId).some(
    (entry) => entry.id === ancestorId,
  );
}

export function responseLeafId(response: JsonlRecord): string | null {
  const data = response["data"];
  if (!isJsonObject(data))
    throw new TypeError("Invalid OmO navigation response");
  const leafId = data["leafId"];
  if (leafId !== null && typeof leafId !== "string") {
    throw new TypeError("Invalid OmO navigation leaf");
  }
  return leafId;
}
