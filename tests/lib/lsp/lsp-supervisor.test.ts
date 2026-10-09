// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { isProcessLive } from "@/tests/helpers/process-liveness";

const supervisorPath = path.resolve("lib/lsp/lsp-supervisor.mjs");
const fixturePath = path.resolve("tests/fixtures/fake-lsp-server.mjs");
let directory: string;
let fixturePidFile: string;
let grandchildPidFile: string;
let supervisorPidFile: string;
let children: ChildProcessWithoutNullStreams[];
let groups: number[];

function pidOf(child: ChildProcessWithoutNullStreams): number {
  if (child.pid === undefined) throw new Error("Expected spawned child pid");
  return child.pid;
}

async function readPid(file: string): Promise<number> {
  await vi.waitFor(() => expect(existsSync(file)).toBe(true), {
    interval: 50,
    timeout: 2_000,
  });
  const pid = Number(readFileSync(file, "utf8"));
  expect(Number.isSafeInteger(pid) && pid > 0).toBe(true);
  return pid;
}

function frame(message: object): string {
  const body = JSON.stringify(message);
  return `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;
}

function startSupervisor(
  parentPid = String(process.pid),
  command = process.execPath,
) {
  const child = spawn(
    process.execPath,
    [supervisorPath, `--parent-pid=${parentPid}`, "--", command, fixturePath],
    { detached: true, stdio: "pipe", env: process.env },
  );
  children.push(child);
  groups.push(pidOf(child));
  return child;
}

async function liveTree(supervisorPid: number): Promise<readonly number[]> {
  const pids = [
    supervisorPid,
    await readPid(fixturePidFile),
    await readPid(grandchildPidFile),
  ];
  expect(pids.map(isProcessLive)).toEqual([true, true, true]);
  return pids;
}

async function expectGone(pids: readonly number[], timeout = 2_000) {
  await vi.waitFor(
    () => expect(pids.map(isProcessLive)).toEqual(pids.map(() => false)),
    {
      interval: 50,
      timeout,
    },
  );
}

beforeEach(() => {
  directory = mkdtempSync(path.join(tmpdir(), "devhub-lsp-supervisor-"));
  fixturePidFile = path.join(directory, "fixture.pid");
  grandchildPidFile = path.join(directory, "grandchild.pid");
  supervisorPidFile = path.join(directory, "supervisor.pid");
  children = [];
  groups = [];
  for (const key of [
    "FAKE_LSP_IGNORE_SHUTDOWN",
    "FAKE_LSP_EXIT_ON_HOVER",
    "FAKE_LSP_RECORD_FILE",
    "FAKE_LSP_ASK_CONFIG",
  ])
    vi.stubEnv(key, undefined);
  vi.stubEnv("FAKE_LSP_PID_FILE", fixturePidFile);
  vi.stubEnv("FAKE_LSP_SPAWN_GRANDCHILD", "1");
  vi.stubEnv("FAKE_LSP_GRANDCHILD_PID_FILE", grandchildPidFile);
});

afterEach(async () => {
  // The intermediate parent publishes a group we own even if readiness failed.
  const supervisorPid = existsSync(supervisorPidFile)
    ? Number(readFileSync(supervisorPidFile, "utf8"))
    : children[0]?.pid;
  if (supervisorPid !== undefined) groups.push(supervisorPid);
  for (const pgid of new Set(groups)) {
    const memberPids = [pgid];
    if (pgid === supervisorPid) {
      for (const file of [fixturePidFile, grandchildPidFile]) {
        if (existsSync(file))
          memberPids.push(Number(readFileSync(file, "utf8")));
      }
    }
    if (!memberPids.some(isProcessLive)) continue;
    try {
      process.kill(-pgid, "SIGKILL");
    } catch (error) {
      if (
        !(error instanceof Error && "code" in error && error.code === "ESRCH")
      )
        throw error;
    }
  }
  for (const child of children) {
    child.stdin.destroy();
    if (child.exitCode === null && child.signalCode === null)
      await once(child, "exit");
    child.stdout.destroy();
    child.stderr.destroy();
  }
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});

describe.skipIf(process.platform === "win32")(
  "LSP process-group supervisor",
  () => {
    it("exits the group when the requested command cannot spawn", async () => {
      // Given
      const child = startSupervisor(
        String(process.pid),
        path.join(directory, "missing-command"),
      );
      let errorOutput = "";
      child.stderr.on("data", (chunk: Buffer) => {
        errorOutput += chunk.toString();
      });
      // When
      const [code, signal] = await once(child, "close");
      // Then
      expect([code, signal]).toEqual([null, "SIGKILL"]);
      expect(errorOutput).toContain("[lsp-supervisor] vtsls failed to start:");
      expect(existsSync(fixturePidFile)).toBe(false);
    });

    it("passes only framed LSP output when initialize is sent through stdin", async () => {
      // Given
      const child = startSupervisor();
      await liveTree(pidOf(child));
      let output = "";
      child.stdout.on("data", (chunk: Buffer) => {
        output += chunk.toString();
      });
      const closed = once(child, "close");
      const expected = frame({
        jsonrpc: "2.0",
        id: 0,
        result: {
          capabilities: {
            textDocumentSync: 2,
            hoverProvider: true,
            referencesProvider: true,
            completionProvider: { resolveProvider: true },
          },
        },
      });
      // When
      child.stdin.write(frame({ jsonrpc: "2.0", id: 0, method: "initialize" }));
      await vi.waitFor(() => expect(output).toBe(expected), {
        interval: 50,
        timeout: 2_000,
      });
      child.stdin.write(frame({ jsonrpc: "2.0", method: "exit" }));
      await closed;
      // Then: include all bytes, including any shutdown diagnostics.
      expect(output).toBe(expected);
    });

    it("kills all descendants when the fixture exits itself", async () => {
      // Given
      const child = startSupervisor();
      const pids = await liveTree(pidOf(child));
      // When
      child.stdin.write(frame({ jsonrpc: "2.0", method: "exit" }));
      // Then
      await expectGone(pids);
    });

    it("kills all descendants when the fixture crashes", async () => {
      // Given
      const child = startSupervisor();
      const pids = await liveTree(pidOf(child));
      // When
      process.kill(await readPid(fixturePidFile), "SIGKILL");
      // Then
      await expectGone(pids);
    });

    it.each(["SIGTERM", "SIGINT", "SIGHUP"] as const)(
      "kills the group when %s reaches an uncooperative fixture",
      async (signal) => {
        // Given
        vi.stubEnv("FAKE_LSP_IGNORE_SHUTDOWN", "1");
        const child = startSupervisor();
        const pids = await liveTree(pidOf(child));
        // When
        process.kill(-pidOf(child), signal);
        // Then
        await expectGone(pids);
      },
    );

    it("kills the group when its intermediate parent disappears", async () => {
      // Given
      const parent = spawn(
        process.execPath,
        [
          "-e",
          `
      const { spawn } = require("node:child_process");
      const { writeFileSync } = require("node:fs");
      const child = spawn(process.execPath, [${JSON.stringify(supervisorPath)},
        "--parent-pid=" + process.pid, "--", process.execPath, ${JSON.stringify(fixturePath)}],
        { detached: true, stdio: "pipe" });
      writeFileSync(${JSON.stringify(supervisorPidFile)}, String(child.pid));
      setInterval(() => {}, 1000);
    `,
        ],
        { detached: true, stdio: "pipe", env: process.env },
      );
      children.push(parent);
      groups.push(pidOf(parent));
      const supervisorPid = await readPid(supervisorPidFile);
      groups.push(supervisorPid);
      const pids = await liveTree(supervisorPid);
      const exited = once(parent, "exit");
      // When
      parent.kill("SIGKILL");
      await exited;
      // Then
      await expectGone(pids, 3_000);
    });

    it.each(["abc", "0", "-1", "1.5", "9007199254740992"])(
      "rejects invalid parent pid %s without spawning the fixture",
      async (parentPid) => {
        // Given
        const child = startSupervisor(parentPid);
        let errorOutput = "";
        child.stderr.on("data", (chunk: Buffer) => {
          errorOutput += chunk.toString();
        });
        // When
        const [code] = await once(child, "close");
        // Then
        expect(code).toBe(2);
        expect(errorOutput.trim().split("\n")).toHaveLength(1);
        expect(existsSync(fixturePidFile)).toBe(false);
      },
    );
  },
);
