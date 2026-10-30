import { readFile } from "node:fs/promises";
import { OmoCommandError } from "@/lib/omo/errors";
import type { JsonlRecord } from "@/lib/omo/jsonl";
import { isJsonObject } from "@/lib/omo/session-registry-records";

// omo cuts any socket connection whose queued output would pass 64 MiB, so a
// full get_entries for a long session takes down dev-hub's whole connection.
// Entries already in the session file are read from disk instead, and omo is
// asked only for the entries after the last one on disk.

export type OmoEntriesSender = (
  command: JsonlRecord,
  onResponse?: (response: JsonlRecord) => void,
) => Promise<JsonlRecord>;

export type OmoEntriesRequest = {
  readonly send: OmoEntriesSender;
  readonly durableId: string;
  readonly sessionPath: string | null;
  readonly onResponse?: (response: JsonlRecord) => void;
};

function isMissingFileError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  );
}

function parseLine(line: string): JsonlRecord | null {
  try {
    const parsed: unknown = JSON.parse(line);
    return isJsonObject(parsed) ? parsed : null;
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

async function readSessionFileEntries(
  sessionPath: string,
  durableId: string,
): Promise<JsonlRecord[]> {
  let text: string;
  try {
    text = await readFile(sessionPath, "utf8");
  } catch (error) {
    // Remote workspaces report paths on the remote machine.
    if (isMissingFileError(error)) return [];
    throw error;
  }
  const lines = text.split("\n");
  const header = parseLine(lines[0] ?? "");
  if (header?.["type"] !== "session" || header["id"] !== durableId) return [];
  const entries: JsonlRecord[] = [];
  for (const line of lines.slice(1)) {
    if (line.length === 0) continue;
    const entry = parseLine(line);
    if (entry !== null && typeof entry["id"] === "string") entries.push(entry);
  }
  return entries;
}

function withFileEntries(
  fileEntries: readonly JsonlRecord[],
  response: JsonlRecord,
): JsonlRecord {
  const data = response["data"];
  if (!isJsonObject(data) || !Array.isArray(data["entries"])) return response;
  return {
    ...response,
    data: { ...data, entries: [...fileEntries, ...data["entries"]] },
  };
}

function isUnknownCursorError(error: unknown): boolean {
  return error instanceof OmoCommandError && error.errorCode === "not_found";
}

export async function requestOmoEntries(
  request: OmoEntriesRequest,
): Promise<JsonlRecord> {
  const { send, onResponse } = request;
  const fileEntries =
    request.sessionPath === null
      ? []
      : await readSessionFileEntries(request.sessionPath, request.durableId);
  const lastFileEntryId = fileEntries.at(-1)?.["id"];
  if (typeof lastFileEntryId === "string") {
    let merged: JsonlRecord | undefined;
    const mergeResponse = (response: JsonlRecord): JsonlRecord => {
      merged ??= withFileEntries(fileEntries, response);
      return merged;
    };
    try {
      const response = await send(
        { type: "get_entries", since: lastFileEntryId },
        onResponse && ((response) => onResponse(mergeResponse(response))),
      );
      return mergeResponse(response);
    } catch (error) {
      if (!isUnknownCursorError(error)) throw error;
    }
  }
  return send({ type: "get_entries" }, onResponse);
}
