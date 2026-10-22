// @vitest-environment node

import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  activeBranch,
  encodeCwdDir,
  findOmoSubAgentSessionIds,
  findOmoSubAgentTranscript,
  listOmoSessionsForCwd,
  normalizeTimestampMs,
  readOmoSessionEntries,
  type SessionEntry,
} from "@/lib/omo/sessions-on-disk";

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), "omo-sessions-on-disk-"));
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

function jsonlLine(record: Record<string, unknown>): string {
  return JSON.stringify(record);
}

async function writeSessionFile(
  sessionsDir: string,
  fileName: string,
  lines: readonly Record<string, unknown>[],
): Promise<string> {
  await mkdir(sessionsDir, { recursive: true });
  const filePath = join(sessionsDir, fileName);
  await writeFile(filePath, lines.map(jsonlLine).join("\n") + "\n", "utf8");
  return filePath;
}

function header(overrides: Record<string, unknown> = {}) {
  return {
    type: "session",
    version: 3,
    id: "session-id",
    timestamp: "2024-12-03T14:00:00.000Z",
    cwd: "/placeholder",
    ...overrides,
  };
}

function userMessageEntry(id: string, parentId: string | null, text: string) {
  return {
    type: "message",
    id,
    parentId,
    timestamp: 1733234401000,
    message: { role: "user", content: text, timestamp: 1733234401000 },
  };
}

function sessionInfoEntry(id: string, parentId: string | null, name: string) {
  return {
    type: "session_info",
    id,
    parentId,
    timestamp: 1733234402000,
    name,
  };
}

describe("encodeCwdDir", () => {
  it("strips the leading separator and replaces path separators with dashes", () => {
    expect(encodeCwdDir("/a/b/c")).toBe("a-b-c");
    expect(encodeCwdDir("/a-b")).toBe("a-b");
  });

  it("replaces backslashes and colons the same way", () => {
    expect(encodeCwdDir("C:\\Users\\dev")).toBe("C--Users-dev");
  });
});

describe("normalizeTimestampMs", () => {
  it("parses ISO strings to epoch milliseconds", () => {
    expect(normalizeTimestampMs("2024-12-03T14:00:00.000Z")).toBe(
      Date.parse("2024-12-03T14:00:00.000Z"),
    );
  });

  it("multiplies epoch-seconds values by 1000", () => {
    const seconds = 1733234400;
    expect(normalizeTimestampMs(seconds)).toBe(seconds * 1000);
  });

  it("leaves epoch-millisecond values unchanged", () => {
    const ms = 1733234400000;
    expect(normalizeTimestampMs(ms)).toBe(ms);
  });
});

describe("listOmoSessionsForCwd", () => {
  it("separates two cwds that collide on the directory encoding via realpath filtering", async () => {
    const cwdA = join(tempRoot, "a-b");
    const cwdB = join(tempRoot, "a", "b");
    await mkdir(cwdA, { recursive: true });
    await mkdir(cwdB, { recursive: true });

    expect(encodeCwdDir(cwdA)).toBe(encodeCwdDir(cwdB));

    const agentDir = join(tempRoot, "agent");
    const sessionsDir = join(agentDir, "sessions", `--${encodeCwdDir(cwdA)}--`);

    await writeSessionFile(sessionsDir, "session-a.jsonl", [
      header({ id: "session-a", cwd: cwdA }),
      userMessageEntry("m1", null, "hello from A"),
    ]);
    await writeSessionFile(sessionsDir, "session-b.jsonl", [
      header({ id: "session-b", cwd: cwdB }),
      userMessageEntry("m1", null, "hello from B"),
    ]);

    const resultsA = await listOmoSessionsForCwd({ agentDir, cwd: cwdA });
    const resultsB = await listOmoSessionsForCwd({ agentDir, cwd: cwdB });

    expect(resultsA.map((r) => r.durableId)).toEqual(["session-a"]);
    expect(resultsB.map((r) => r.durableId)).toEqual(["session-b"]);
  });

  it("matches a symlinked cwd via realpath resolution", async () => {
    const realDir = join(tempRoot, "real");
    const symDir = join(tempRoot, "sym");
    await mkdir(realDir, { recursive: true });
    await symlink(realDir, symDir);

    const agentDir = join(tempRoot, "agent");
    const sessionsDir = join(
      agentDir,
      "sessions",
      `--${encodeCwdDir(symDir)}--`,
    );
    await writeSessionFile(sessionsDir, "session.jsonl", [
      header({ id: "session-real", cwd: realDir }),
      userMessageEntry("m1", null, "hi"),
    ]);

    const results = await listOmoSessionsForCwd({ agentDir, cwd: symDir });
    expect(results.map((r) => r.durableId)).toEqual(["session-real"]);
  });

  it("reports forkedFrom from parentSession but still lists the forked session", async () => {
    const cwd = join(tempRoot, "project");
    await mkdir(cwd, { recursive: true });
    const agentDir = join(tempRoot, "agent");
    const sessionsDir = join(agentDir, "sessions", `--${encodeCwdDir(cwd)}--`);

    await writeSessionFile(sessionsDir, "forked.jsonl", [
      header({
        id: "forked-session",
        cwd,
        parentSession: "/other/original.jsonl",
      }),
      userMessageEntry("m1", null, "forked message"),
    ]);

    const results = await listOmoSessionsForCwd({ agentDir, cwd });
    expect(results).toHaveLength(1);
    expect(results[0]?.forkedFrom).toBe("/other/original.jsonl");
  });

  it("prefers the session_info title over the first user text", async () => {
    const cwd = join(tempRoot, "project");
    await mkdir(cwd, { recursive: true });
    const agentDir = join(tempRoot, "agent");
    const sessionsDir = join(agentDir, "sessions", `--${encodeCwdDir(cwd)}--`);

    await writeSessionFile(sessionsDir, "named.jsonl", [
      header({ id: "named-session", cwd }),
      userMessageEntry("m1", null, "this should not be the title"),
      sessionInfoEntry("i1", "m1", "Custom Session Name"),
      sessionInfoEntry("i2", "i1", "Latest Session Name"),
    ]);
    await writeSessionFile(sessionsDir, "unnamed.jsonl", [
      header({ id: "unnamed-session", cwd }),
      {
        ...userMessageEntry("m1", null, "This is the fallback title text"),
        timestamp: "2024-12-03T15:00:00.000Z",
      },
    ]);
    await writeSessionFile(sessionsDir, "empty.jsonl", [
      header({
        id: "empty-session",
        cwd,
        timestamp: "2024-12-03T16:00:00.000Z",
      }),
    ]);

    const results = await listOmoSessionsForCwd({ agentDir, cwd });
    const byId = new Map(results.map((r) => [r.durableId, r]));

    expect(results.map((result) => result.durableId)).toEqual([
      "empty-session",
      "unnamed-session",
      "named-session",
    ]);
    expect(byId.get("named-session")?.title).toBe("Latest Session Name");
    expect(byId.get("named-session")?.isTitleProvisional).toBe(false);
    expect(byId.get("unnamed-session")?.isTitleProvisional).toBe(false);
    expect(byId.get("unnamed-session")?.title).toBe(
      "This is the fallback title text",
    );
    expect(byId.get("empty-session")?.title).toBe("Untitled");
  });

  it("truncates the first-user-text title to 80 characters", async () => {
    const cwd = join(tempRoot, "project");
    await mkdir(cwd, { recursive: true });
    const agentDir = join(tempRoot, "agent");
    const sessionsDir = join(agentDir, "sessions", `--${encodeCwdDir(cwd)}--`);
    const longText = "x".repeat(200);

    await writeSessionFile(sessionsDir, "long.jsonl", [
      header({ id: "long-session", cwd }),
      userMessageEntry("m1", null, longText),
    ]);

    const results = await listOmoSessionsForCwd({ agentDir, cwd });
    expect(results[0]?.title).toBe("x".repeat(80));
  });

  it("normalizes header.timestamp into createdMs", async () => {
    const cwd = join(tempRoot, "project");
    await mkdir(cwd, { recursive: true });
    const agentDir = join(tempRoot, "agent");
    const sessionsDir = join(agentDir, "sessions", `--${encodeCwdDir(cwd)}--`);

    await writeSessionFile(sessionsDir, "session.jsonl", [
      header({
        id: "session-ts",
        cwd,
        timestamp: "2024-12-03T14:00:00.000Z",
      }),
      userMessageEntry("m1", null, "hi"),
    ]);

    const results = await listOmoSessionsForCwd({ agentDir, cwd });
    expect(results[0]?.createdMs).toBe(Date.parse("2024-12-03T14:00:00.000Z"));
  });

  it("takes updatedMs from the last message, not later housekeeping entries or mtime", async () => {
    const cwd = join(tempRoot, "project");
    await mkdir(cwd, { recursive: true });
    const agentDir = join(tempRoot, "agent");
    const sessionsDir = join(agentDir, "sessions", `--${encodeCwdDir(cwd)}--`);

    await writeSessionFile(sessionsDir, "session.jsonl", [
      header({ id: "session-activity", cwd }),
      userMessageEntry("m1", null, "hi"),
      {
        type: "message",
        id: "m2",
        parentId: "m1",
        timestamp: "2024-12-03T15:00:00.000Z",
        message: { role: "assistant", content: "hello" },
      },
      {
        type: "custom",
        id: "c1",
        parentId: "m2",
        timestamp: "2024-12-05T09:00:00.000Z",
        customType: "pi-rules.scan",
      },
      {
        type: "model_change",
        id: "c2",
        parentId: "c1",
        timestamp: "2024-12-05T09:00:01.000Z",
        provider: "anthropic",
        modelId: "model",
      },
    ]);

    const results = await listOmoSessionsForCwd({ agentDir, cwd });
    expect(results[0]?.updatedMs).toBe(Date.parse("2024-12-03T15:00:00.000Z"));
  });

  it("falls back to createdMs for a session with no messages", async () => {
    const cwd = join(tempRoot, "project");
    await mkdir(cwd, { recursive: true });
    const agentDir = join(tempRoot, "agent");
    const sessionsDir = join(agentDir, "sessions", `--${encodeCwdDir(cwd)}--`);

    await writeSessionFile(sessionsDir, "empty.jsonl", [
      header({ id: "session-empty", cwd }),
      {
        type: "custom",
        id: "c1",
        parentId: null,
        timestamp: "2024-12-05T09:00:00.000Z",
        customType: "senpi-memory.session-binding",
      },
    ]);

    const results = await listOmoSessionsForCwd({ agentDir, cwd });
    expect(results[0]?.updatedMs).toBe(Date.parse("2024-12-03T14:00:00.000Z"));
  });

  it("reads the last message from the end of a file larger than the scan window", async () => {
    const cwd = join(tempRoot, "project");
    await mkdir(cwd, { recursive: true });
    const agentDir = join(tempRoot, "agent");
    const sessionsDir = join(agentDir, "sessions", `--${encodeCwdDir(cwd)}--`);

    const lines: Record<string, unknown>[] = [
      header({ id: "large-session", cwd }),
      userMessageEntry("m1", null, "early"),
    ];
    let parentId = "m1";
    for (let i = 0; i < 30; i += 1) {
      const id = `pad${i}`;
      lines.push({
        type: "custom",
        id,
        parentId,
        timestamp: "2024-12-03T14:00:01.000Z",
        customType: "padding",
        data: "p".repeat(50_000),
      });
      parentId = id;
    }
    lines.push(
      {
        type: "message",
        id: "m-last",
        parentId,
        timestamp: "2024-12-04T10:00:00.000Z",
        message: { role: "assistant", content: "late" },
      },
      {
        type: "custom",
        id: "c-last",
        parentId: "m-last",
        timestamp: "2024-12-06T10:00:00.000Z",
        customType: "claude-sdk-oauth-binding",
      },
    );
    await writeSessionFile(sessionsDir, "large.jsonl", lines);

    const results = await listOmoSessionsForCwd({ agentDir, cwd });
    expect(results[0]?.updatedMs).toBe(Date.parse("2024-12-04T10:00:00.000Z"));
  });

  it("respects the 1 MiB per-file header scan cap", async () => {
    const cwd = join(tempRoot, "project");
    await mkdir(cwd, { recursive: true });
    const agentDir = join(tempRoot, "agent");
    const sessionsDir = join(agentDir, "sessions", `--${encodeCwdDir(cwd)}--`);

    const paddingEntry = (id: string, parentId: string | null) => ({
      type: "custom",
      id,
      parentId,
      timestamp: "2024-12-03T14:00:01.000Z",
      customType: "padding",
      data: "p".repeat(50_000),
    });

    const lines: Record<string, unknown>[] = [
      header({ id: "capped-session", cwd }),
      userMessageEntry("m1", null, "in-window fallback title"),
    ];
    let parentId = "m1";
    for (let i = 0; i < 30; i += 1) {
      const id = `pad${i}`;
      lines.push(paddingEntry(id, parentId));
      parentId = id;
    }
    lines.push(
      sessionInfoEntry("i-out-of-window", parentId, "Should Be Ignored"),
    );

    await writeSessionFile(sessionsDir, "capped.jsonl", lines);

    const results = await listOmoSessionsForCwd({ agentDir, cwd });
    expect(results).toHaveLength(1);
    expect(results[0]?.title).toBe("in-window fallback title");
    expect(results[0]?.isTitleProvisional).toBe(true);
  });

  it("returns an empty list when the cwd's session directory does not exist", async () => {
    const cwd = join(tempRoot, "missing");
    await mkdir(cwd, { recursive: true });
    const agentDir = join(tempRoot, "agent");

    const results = await listOmoSessionsForCwd({ agentDir, cwd });
    expect(results).toEqual([]);
  });
});

describe("readOmoSessionEntries", () => {
  it("parses entries in order, skipping the header line", async () => {
    const filePath = join(tempRoot, "session.jsonl");
    await writeFile(
      filePath,
      [
        header({ id: "s1", cwd: tempRoot }),
        userMessageEntry("m1", null, "hi"),
        userMessageEntry("m2", "m1", "there"),
      ]
        .map(jsonlLine)
        .join("\n") + "\n",
      "utf8",
    );

    const entries = await readOmoSessionEntries(filePath);
    expect(entries.map((e) => e.id)).toEqual(["m1", "m2"]);
  });

  it("skips malformed lines with a console.warn instead of throwing", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const filePath = join(tempRoot, "session.jsonl");
    await writeFile(
      filePath,
      [
        jsonlLine(header({ id: "s1", cwd: tempRoot })),
        jsonlLine(userMessageEntry("m1", null, "hi")),
        "{not valid json",
        jsonlLine({ type: "unknown_future_type", id: "m2", parentId: "m1" }),
        jsonlLine(userMessageEntry("m3", "m1", "still works")),
      ].join("\n") + "\n",
      "utf8",
    );

    const result = await readOmoSessionEntries(filePath);
    expect(result.map((e) => e.id)).toEqual(["m1", "m3"]);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("respects the 64 MiB total entry cap without throwing", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const filePath = join(tempRoot, "huge-session.jsonl");

    const lineCount = 20;
    const chunkChars = 4_000_000;
    const lines = [jsonlLine(header({ id: "huge", cwd: tempRoot }))];
    let parentId: string | null = null;
    for (let i = 0; i < lineCount; i += 1) {
      const id = `e${i}`;
      lines.push(
        jsonlLine({
          type: "custom",
          id,
          parentId,
          timestamp: "2024-12-03T14:00:01.000Z",
          customType: "bulk",
          data: "z".repeat(chunkChars),
        }),
      );
      parentId = id;
    }

    await writeFile(filePath, lines.join("\n") + "\n", "utf8");

    const entries = await readOmoSessionEntries(filePath);
    expect(entries.length).toBeLessThan(lineCount);
    expect(entries.length).toBeGreaterThan(0);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  }, 30_000);
});

describe("activeBranch", () => {
  it("returns only the leaf's own ancestor chain, ignoring an abandoned sibling branch", () => {
    const entries: SessionEntry[] = [
      userMessageEntry("root", null, "root") as SessionEntry,
      userMessageEntry("shared", "root", "shared ancestor") as SessionEntry,
      userMessageEntry("branchA1", "shared", "branch A step 1") as SessionEntry,
      userMessageEntry("branchA2", "branchA1", "branch A leaf") as SessionEntry,
      userMessageEntry(
        "branchB1",
        "shared",
        "abandoned branch",
      ) as SessionEntry,
    ];

    const branch = activeBranch(entries, "branchA2");
    expect(branch.map((e) => e.id)).toEqual([
      "root",
      "shared",
      "branchA1",
      "branchA2",
    ]);
  });

  it("returns an empty array when the leaf id is not found", () => {
    const entries: SessionEntry[] = [
      userMessageEntry("root", null, "root") as SessionEntry,
    ];
    expect(activeBranch(entries, "missing")).toEqual([]);
  });
});

describe("omo sub-agent transcripts", () => {
  function subAgentSessionsDir(workspace: string, taskId: string): string {
    return join(
      workspace,
      ".omo",
      "senpi-task",
      "children",
      taskId,
      "sessions",
      taskId,
    );
  }

  function agentDir(): string {
    return join(tempRoot, "agent");
  }

  async function projectSubAgentSessionsDir(
    workspace: string,
    taskId: string,
  ): Promise<string> {
    const workspaceRealPath = await realpath(workspace);
    const hash = createHash("sha256").update(workspaceRealPath).digest("hex");
    return join(
      agentDir(),
      "projects",
      `repo-${hash.slice(0, 12)}`,
      "senpi-task",
      "children",
      taskId,
      "sessions",
      taskId,
    );
  }

  async function createWorkspace(): Promise<string> {
    const workspace = join(tempRoot, "repo");
    await mkdir(workspace, { recursive: true });
    return workspace;
  }

  it("finds a task's sub-agent by the session id in its header, whatever the file is called", async () => {
    const workspace = await createWorkspace();
    const transcript = await writeSessionFile(
      subAgentSessionsDir(workspace, "st_01a13ed1"),
      "2026-10-15T09-08-06.282Z_7ef5e249-e790-4842-a9cf-52c41f0b33b2.jsonl",
      [
        header({ id: "01a13ed1-9a17", cwd: workspace }),
        userMessageEntry("prompt", null, "gate the deposits UI"),
      ],
    );
    await writeFile(`${transcript}.claude-sdk-oauth-binding.json`, "{}");

    expect(
      await findOmoSubAgentSessionIds(agentDir(), workspace, "st_01a13ed1"),
    ).toEqual(["01a13ed1-9a17"]);
    expect(
      await findOmoSubAgentTranscript(agentDir(), workspace, "01a13ed1-9a17"),
    ).toBe(transcript);
    expect(
      await findOmoSubAgentTranscript(agentDir(), workspace, "7ef5e249"),
    ).toBeNull();
  });

  it("finds a task's sub-agent in omo's per-project state directory under the agent dir", async () => {
    const workspace = await createWorkspace();
    const transcript = await writeSessionFile(
      await projectSubAgentSessionsDir(workspace, "st_01a162b9"),
      "2026-10-22T08-28-23.708Z_f3be0286-2984-4657-8afa-f445d5ba754e.jsonl",
      [header({ id: "01a162b9-c32d", cwd: workspace })],
    );

    expect(
      await findOmoSubAgentSessionIds(agentDir(), workspace, "st_01a162b9"),
    ).toEqual(["01a162b9-c32d"]);
    expect(
      await findOmoSubAgentTranscript(agentDir(), workspace, "01a162b9-c32d"),
    ).toBe(transcript);
  });

  it("ignores another workspace's transcripts, unknown tasks and unsafe task ids", async () => {
    const workspace = await createWorkspace();
    await writeSessionFile(
      subAgentSessionsDir(workspace, "st_other"),
      "other.jsonl",
      [header({ id: "worker-other", cwd: tempRoot })],
    );
    await writeSessionFile(join(tempRoot, "outside"), "escaped.jsonl", [
      header({ id: "worker-escaped", cwd: workspace }),
    ]);

    expect(
      await findOmoSubAgentSessionIds(agentDir(), workspace, "st_other"),
    ).toEqual([]);
    expect(
      await findOmoSubAgentTranscript(agentDir(), workspace, "worker-other"),
    ).toBeNull();
    expect(
      await findOmoSubAgentSessionIds(agentDir(), workspace, "st_missing"),
    ).toEqual([]);
    expect(
      await findOmoSubAgentSessionIds(
        agentDir(),
        workspace,
        "../../../../outside",
      ),
    ).toEqual([]);
    expect(
      await findOmoSubAgentSessionIds(
        agentDir(),
        join(tempRoot, "no-repo"),
        "st_other",
      ),
    ).toEqual([]);
  });
});
