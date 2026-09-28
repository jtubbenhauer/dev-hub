// @vitest-environment node

import {
  access,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalFsSessionSource } from "@/lib/omo/session-source";
import { encodeCwdDir } from "@/lib/omo/sessions-on-disk";

let tempRoot: string;
let workspacePath: string;
let agentDir: string;

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), "omo-session-source-"));
  workspacePath = join(tempRoot, "workspace");
  agentDir = join(tempRoot, "agent");
  await mkdir(workspacePath, { recursive: true });
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

async function writeSession(
  durableId: string,
  cwd = workspacePath,
): Promise<string> {
  const sessionsDir = join(
    agentDir,
    "sessions",
    `--${encodeCwdDir(workspacePath)}--`,
  );
  await mkdir(sessionsDir, { recursive: true });
  const sessionFile = join(sessionsDir, `${durableId}.jsonl`);
  const lines = [
    {
      type: "session",
      version: 3,
      id: durableId,
      timestamp: "2026-09-28T10:07:00.000Z",
      cwd,
    },
    {
      type: "session_info",
      id: "info-1",
      parentId: null,
      timestamp: "2026-09-28T10:07:01.000Z",
      name: "Probe",
    },
  ];
  await writeFile(
    sessionFile,
    `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`,
    "utf8",
  );
  return sessionFile;
}

function createSource(): LocalFsSessionSource {
  return new LocalFsSessionSource({ agentDir, workspacePath });
}

describe("LocalFsSessionSource", () => {
  it("lists, authorizes, and reads sessions for the canonical workspace", async () => {
    await writeSession("session-1");
    const source = createSource();

    const [canonicalPath, sessions, isAuthorized, entries] = await Promise.all([
      source.canonicalWorkspacePath(),
      source.list(),
      source.authorizeSession("session-1"),
      source.readEntries("session-1"),
    ]);

    expect(canonicalPath).toBe(await realpath(workspacePath));
    expect(sessions.map((session) => session.durableId)).toEqual(["session-1"]);
    expect(isAuthorized).toBe(true);
    expect(entries).toMatchObject([{ type: "session_info", name: "Probe" }]);
  });

  it("does not authorize a header from another workspace", async () => {
    const foreignWorkspace = join(tempRoot, "foreign-workspace");
    await mkdir(foreignWorkspace);
    await writeSession("foreign", foreignWorkspace);

    await expect(createSource().authorizeSession("foreign")).resolves.toBe(
      false,
    );
  });

  it("removes a reported probe file and treats a missing file as success", async () => {
    const source = createSource();
    const sessionFile = await writeSession("probe-with-path");

    await source.removeProbeSession("probe-with-path", sessionFile);
    await expect(access(sessionFile)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      source.removeProbeSession("probe-with-path", sessionFile),
    ).resolves.toBeUndefined();
  });

  it("finds a probe by durable header id when no session path is reported", async () => {
    const source = createSource();
    const sessionFile = await writeSession("probe-by-id");

    await source.removeProbeSession("probe-by-id", undefined);

    await expect(access(sessionFile)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("removes an ordinary session by durable id", async () => {
    const source = createSource();
    const sessionFile = await writeSession("session-to-remove");

    await source.remove("session-to-remove");

    await expect(access(sessionFile)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
