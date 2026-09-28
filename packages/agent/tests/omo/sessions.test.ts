import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  deleteOmoSession,
  encodeCwdDir,
  listOmoSessionsForWorkspace,
  readOmoSessionEntries,
} from "../../src/omo/sessions.js";

function sessionHeaderLine(id: string, cwd: string): string {
  return JSON.stringify({
    type: "session",
    version: 3,
    id,
    timestamp: "2024-01-01T00:00:00.000Z",
    cwd,
  });
}

function messageEntryLine(id: string, parentId: string | null): string {
  return JSON.stringify({
    type: "message",
    id,
    parentId,
    timestamp: "2024-01-01T00:01:00.000Z",
    message: { role: "user", content: "hello world" },
  });
}

describe("listOmoSessionsForWorkspace / readOmoSessionEntries", () => {
  let agentDir: string;
  let workspaceA: string;
  let workspaceB: string;

  beforeEach(async () => {
    agentDir = await mkdtemp(join(tmpdir(), "devhub-agent-sessions-"));
    workspaceA = await mkdtemp(join(tmpdir(), "devhub-agent-workspace-a-"));
    workspaceB = await mkdtemp(join(tmpdir(), "devhub-agent-workspace-b-"));
  });

  afterEach(async () => {
    await rm(agentDir, { recursive: true, force: true });
    await rm(workspaceA, { recursive: true, force: true });
    await rm(workspaceB, { recursive: true, force: true });
  });

  it("lists only sessions whose header cwd realpath matches the workspace", async () => {
    const sessionsDir = join(
      agentDir,
      "sessions",
      `--${encodeCwdDir(workspaceA)}--`,
    );
    await mkdir(sessionsDir, { recursive: true });

    await writeFile(
      join(sessionsDir, "matching.jsonl"),
      [
        sessionHeaderLine("session-matching", workspaceA),
        messageEntryLine("entry-1", null),
      ].join("\n") + "\n",
    );
    await writeFile(
      join(sessionsDir, "mismatched.jsonl"),
      [
        sessionHeaderLine("session-mismatched", workspaceB),
        messageEntryLine("entry-2", null),
      ].join("\n") + "\n",
    );

    const summaries = await listOmoSessionsForWorkspace(agentDir, workspaceA);

    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.durableId).toBe("session-matching");
  });

  it("returns an empty array when the sessions directory does not exist", async () => {
    const summaries = await listOmoSessionsForWorkspace(agentDir, workspaceA);
    expect(summaries).toEqual([]);
  });

  it("reads entries excluding the header line and normalizes timestamps", async () => {
    const sessionsDir = join(
      agentDir,
      "sessions",
      `--${encodeCwdDir(workspaceA)}--`,
    );
    await mkdir(sessionsDir, { recursive: true });
    const sessionPath = join(sessionsDir, "with-entries.jsonl");
    await writeFile(
      sessionPath,
      [
        sessionHeaderLine("session-with-entries", workspaceA),
        messageEntryLine("entry-1", null),
        messageEntryLine("entry-2", "entry-1"),
      ].join("\n") + "\n",
    );

    const entries = await readOmoSessionEntries(sessionPath);

    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ id: "entry-1", parentId: null });
    expect(typeof entries[0]?.timestamp).toBe("number");
  });

  it("skips a single record over 16 MiB without buffering it, keeping surrounding valid entries", async () => {
    const sessionsDir = join(
      agentDir,
      "sessions",
      `--${encodeCwdDir(workspaceA)}--`,
    );
    await mkdir(sessionsDir, { recursive: true });
    const sessionPath = join(sessionsDir, "with-oversized-record.jsonl");
    const oversizedLine = JSON.stringify({
      type: "message",
      id: "entry-oversized",
      parentId: null,
      timestamp: "2024-01-01T00:01:00.000Z",
      message: { role: "user", content: "x".repeat(17 * 1024 * 1024) },
    });
    await writeFile(
      sessionPath,
      [
        sessionHeaderLine("session-with-oversized-record", workspaceA),
        messageEntryLine("entry-before", null),
        oversizedLine,
        messageEntryLine("entry-after", "entry-before"),
      ].join("\n") + "\n",
    );

    const entries = await readOmoSessionEntries(sessionPath);

    expect(entries.map((entry) => entry.id)).toEqual([
      "entry-before",
      "entry-after",
    ]);
  });

  it("skips malformed and unrecognized lines when reading entries", async () => {
    const sessionsDir = join(
      agentDir,
      "sessions",
      `--${encodeCwdDir(workspaceA)}--`,
    );
    await mkdir(sessionsDir, { recursive: true });
    const sessionPath = join(sessionsDir, "with-garbage.jsonl");
    await writeFile(
      sessionPath,
      [
        sessionHeaderLine("session-with-garbage", workspaceA),
        "not json at all",
        JSON.stringify({ type: "unknown_type", id: "x", parentId: null }),
        messageEntryLine("entry-1", null),
      ].join("\n") + "\n",
    );

    const entries = await readOmoSessionEntries(sessionPath);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.id).toBe("entry-1");
  });
});

describe("deleteOmoSession", () => {
  let agentDir: string;
  let workspaceA: string;

  beforeEach(async () => {
    agentDir = await mkdtemp(join(tmpdir(), "devhub-agent-sessions-"));
    workspaceA = await mkdtemp(join(tmpdir(), "devhub-agent-workspace-a-"));
  });

  afterEach(async () => {
    await rm(agentDir, { recursive: true, force: true });
    await rm(workspaceA, { recursive: true, force: true });
  });

  it("deletes a session file located under <agentDir>/sessions", async () => {
    const sessionsDir = join(
      agentDir,
      "sessions",
      `--${encodeCwdDir(workspaceA)}--`,
    );
    await mkdir(sessionsDir, { recursive: true });
    const sessionPath = join(sessionsDir, "deletable.jsonl");
    await writeFile(sessionPath, sessionHeaderLine("session-x", workspaceA));

    await deleteOmoSession(agentDir, sessionPath, "session-x", workspaceA);

    await expect(readFile(sessionPath)).rejects.toThrow();
  });

  it("refuses to delete a path outside the sessions directory", async () => {
    await mkdir(join(agentDir, "sessions"), { recursive: true });
    const outsidePath = join(workspaceA, "not-a-session.jsonl");
    await writeFile(outsidePath, "irrelevant");

    await expect(
      deleteOmoSession(agentDir, outsidePath, "session-x", workspaceA),
    ).rejects.toThrow(/outside the sessions directory/);
    await expect(readFile(outsidePath)).resolves.toBeTruthy();
  });

  it("refuses to delete when the header id no longer matches (TOCTOU guard)", async () => {
    const sessionsDir = join(
      agentDir,
      "sessions",
      `--${encodeCwdDir(workspaceA)}--`,
    );
    await mkdir(sessionsDir, { recursive: true });
    const sessionPath = join(sessionsDir, "swapped.jsonl");
    await writeFile(sessionPath, sessionHeaderLine("session-x", workspaceA));

    await expect(
      deleteOmoSession(agentDir, sessionPath, "session-expected", workspaceA),
    ).rejects.toThrow(/no longer matches its expected identity/);
    await expect(readFile(sessionPath)).resolves.toBeTruthy();
  });

  it("refuses to delete when the header cwd no longer matches the workspace", async () => {
    const sessionsDir = join(
      agentDir,
      "sessions",
      `--${encodeCwdDir(workspaceA)}--`,
    );
    await mkdir(sessionsDir, { recursive: true });
    const sessionPath = join(sessionsDir, "wrong-cwd.jsonl");
    const otherWorkspace = await mkdtemp(
      join(tmpdir(), "devhub-agent-workspace-other-"),
    );
    await writeFile(
      sessionPath,
      sessionHeaderLine("session-x", otherWorkspace),
    );

    try {
      await expect(
        deleteOmoSession(agentDir, sessionPath, "session-x", workspaceA),
      ).rejects.toThrow(/no longer matches its expected identity/);
      await expect(readFile(sessionPath)).resolves.toBeTruthy();
    } finally {
      await rm(otherWorkspace, { recursive: true, force: true });
    }
  });
});
