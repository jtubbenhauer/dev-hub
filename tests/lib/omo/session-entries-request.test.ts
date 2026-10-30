import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OmoCommandError } from "@/lib/omo/errors";
import type { JsonlRecord } from "@/lib/omo/jsonl";
import {
  requestOmoEntries,
  type OmoEntriesSender,
} from "@/lib/omo/session-entries-request";

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "devhub-entries-"));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

function entry(id: string, parentId: string | null): JsonlRecord {
  return { type: "message", id, parentId, message: { role: "user" } };
}

async function writeSessionFile(
  sessionId: string,
  lines: readonly string[],
): Promise<string> {
  const sessionPath = join(directory, "session.jsonl");
  const header = { type: "session", id: sessionId, cwd: directory };
  await writeFile(sessionPath, [JSON.stringify(header), ...lines].join("\n"));
  return sessionPath;
}

function entriesResponse(
  entries: readonly JsonlRecord[],
  leafId: string,
): JsonlRecord {
  return {
    type: "response",
    command: "get_entries",
    success: true,
    data: { entries, leafId },
  };
}

describe("requestOmoEntries", () => {
  it("reads entries on disk and asks omo only for newer ones", async () => {
    const sessionPath = await writeSessionFile("session-1", [
      JSON.stringify(entry("a", null)),
      JSON.stringify(entry("b", "a")),
      '{"type":"message","id":"partial',
    ]);
    const commands: JsonlRecord[] = [];
    const send: OmoEntriesSender = async (command, onResponse) => {
      commands.push(command);
      const response = entriesResponse([entry("c", "b")], "c");
      onResponse?.(response);
      return response;
    };
    const fenced: JsonlRecord[] = [];

    const response = await requestOmoEntries({
      send,
      durableId: "session-1",
      sessionPath,
      onResponse: (record) => fenced.push(record),
    });

    expect(commands).toEqual([{ type: "get_entries", since: "b" }]);
    expect(response["data"]).toEqual({
      entries: [entry("a", null), entry("b", "a"), entry("c", "b")],
      leafId: "c",
    });
    expect(fenced).toEqual([response]);
  });

  it("falls back to every entry when omo does not know the disk cursor", async () => {
    const sessionPath = await writeSessionFile("session-1", [
      JSON.stringify(entry("a", null)),
    ]);
    const full = entriesResponse([entry("x", null)], "x");
    const commands: JsonlRecord[] = [];
    const send: OmoEntriesSender = async (command) => {
      commands.push(command);
      if (command["since"] !== undefined) {
        throw new OmoCommandError("get_entries", "unknown", "not_found", null);
      }
      return full;
    };

    const response = await requestOmoEntries({
      send,
      durableId: "session-1",
      sessionPath,
    });

    expect(commands).toEqual([
      { type: "get_entries", since: "a" },
      { type: "get_entries" },
    ]);
    expect(response).toBe(full);
  });

  it("ignores a file that belongs to another session", async () => {
    const sessionPath = await writeSessionFile("other-session", [
      JSON.stringify(entry("a", null)),
    ]);
    const commands: JsonlRecord[] = [];
    const send: OmoEntriesSender = async (command) => {
      commands.push(command);
      return entriesResponse([], "a");
    };

    await requestOmoEntries({ send, durableId: "session-1", sessionPath });
    await requestOmoEntries({
      send,
      durableId: "session-1",
      sessionPath: join(directory, "missing.jsonl"),
    });

    expect(commands).toEqual([
      { type: "get_entries" },
      { type: "get_entries" },
    ]);
  });
});
