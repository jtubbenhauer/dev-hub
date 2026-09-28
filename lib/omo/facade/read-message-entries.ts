import { isJsonObject } from "@/lib/omo/session-registry-records";
import {
  normalizeTimestampMs,
  type SessionEntry,
} from "@/lib/omo/sessions-on-disk";
import type { JsonlRecord } from "@/lib/omo/jsonl";

type EntryBase = {
  readonly id: string;
  readonly parentId: string | null;
  readonly timestamp: number;
};

function entryBase(value: JsonlRecord): EntryBase | null {
  const id = value["id"];
  const parentId = value["parentId"];
  const timestamp = value["timestamp"];
  if (
    typeof id !== "string" ||
    (parentId !== null && typeof parentId !== "string") ||
    (typeof timestamp !== "string" && typeof timestamp !== "number")
  ) {
    return null;
  }
  return { id, parentId, timestamp: normalizeTimestampMs(timestamp) };
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

export function parseRpcSessionEntry(value: unknown): SessionEntry | null {
  if (!isJsonObject(value)) return null;
  const base = entryBase(value);
  if (base === null) return null;
  switch (value["type"]) {
    case "message": {
      const message = value["message"];
      if (!isJsonObject(message) || typeof message["role"] !== "string") {
        return null;
      }
      const messageTimestamp = message["timestamp"];
      return {
        ...base,
        type: "message",
        message: {
          role: message["role"],
          content: message["content"],
          ...(typeof messageTimestamp === "string" ||
          typeof messageTimestamp === "number"
            ? { timestamp: normalizeTimestampMs(messageTimestamp) }
            : {}),
        },
      };
    }
    case "model_change":
      return typeof value["provider"] === "string" &&
        typeof value["modelId"] === "string"
        ? {
            ...base,
            type: "model_change",
            provider: value["provider"],
            modelId: value["modelId"],
          }
        : null;
    case "thinking_level_change":
      return typeof value["thinkingLevel"] === "string"
        ? {
            ...base,
            type: "thinking_level_change",
            thinkingLevel: value["thinkingLevel"],
          }
        : null;
    case "compaction":
      return typeof value["summary"] === "string" &&
        typeof value["firstKeptEntryId"] === "string" &&
        typeof value["tokensBefore"] === "number"
        ? {
            ...base,
            type: "compaction",
            summary: value["summary"],
            firstKeptEntryId: value["firstKeptEntryId"],
            tokensBefore: value["tokensBefore"],
            usage: value["usage"],
            details: value["details"],
            ...(optionalBoolean(value["fromHook"]) === undefined
              ? {}
              : { fromHook: optionalBoolean(value["fromHook"]) }),
          }
        : null;
    case "branch_summary": {
      const fromId = value["fromId"];
      return (fromId === null || typeof fromId === "string") &&
        typeof value["summary"] === "string"
        ? {
            ...base,
            type: "branch_summary",
            fromId,
            summary: value["summary"],
            usage: value["usage"],
            details: value["details"],
            ...(optionalBoolean(value["fromHook"]) === undefined
              ? {}
              : { fromHook: optionalBoolean(value["fromHook"]) }),
          }
        : null;
    }
    case "custom":
      return typeof value["customType"] === "string"
        ? {
            ...base,
            type: "custom",
            customType: value["customType"],
            data: value["data"],
          }
        : null;
    case "custom_message":
      return typeof value["customType"] === "string" &&
        typeof value["display"] === "boolean"
        ? {
            ...base,
            type: "custom_message",
            customType: value["customType"],
            content: value["content"],
            display: value["display"],
            details: value["details"],
          }
        : null;
    case "label":
      return typeof value["targetId"] === "string" &&
        (value["label"] === undefined || typeof value["label"] === "string")
        ? {
            ...base,
            type: "label",
            targetId: value["targetId"],
            ...(typeof value["label"] === "string"
              ? { label: value["label"] }
              : {}),
          }
        : null;
    case "session_info":
      return typeof value["name"] === "string"
        ? { ...base, type: "session_info", name: value["name"] }
        : null;
    default:
      return null;
  }
}

export function parseRpcEntriesResponse(response: JsonlRecord): {
  readonly entries: SessionEntry[];
  readonly leafId: string | null;
} {
  const data = response["data"];
  if (!isJsonObject(data) || !Array.isArray(data["entries"])) {
    throw new TypeError("Invalid OmO get_entries response");
  }
  const leafId = data["leafId"];
  if (leafId !== null && typeof leafId !== "string") {
    throw new TypeError("Invalid OmO get_entries leaf");
  }
  return {
    entries: data["entries"].flatMap((entry) => {
      const parsed = parseRpcSessionEntry(entry);
      return parsed === null ? [] : [parsed];
    }),
    leafId,
  };
}
