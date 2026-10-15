// @vitest-environment node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runLineProcess } from "@/packages/shared/src/content-search/process";

const GRANDCHILD_SCRIPT = [
  'const g = require("node:child_process").spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });',
  "console.log(g.pid);",
  "setInterval(() => {}, 1000);",
].join(" ");

const startedPids: number[] = [];
const createdDirs: string[] = [];

afterEach(() => {
  while (startedPids.length > 0) {
    const pid = startedPids.pop();
    if (pid === undefined) continue;
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Already gone.
    }
  }
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Blocks the event loop so an exited child stays an unreaped zombie when
// runLineProcess signals its process group.
function stopAfterBlockingEventLoop(): "stop" {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
  return "stop";
}

function makeGitRepoWithTwoMatchingLines(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "content-search-process-"));
  createdDirs.push(dir);
  execFileSync("git", ["init", "--quiet"], { cwd: dir });
  fs.writeFileSync(path.join(dir, "a.txt"), "a needle\nanother needle\n");
  return dir;
}

function runNodeScript(
  script: string,
  options: {
    readonly timeoutMs?: number;
    readonly signal?: AbortSignal;
    readonly onLine: (line: string) => "continue" | "stop";
  },
) {
  return runLineProcess({
    command: process.execPath,
    args: ["-e", script],
    cwd: process.cwd(),
    timeoutMs: options.timeoutMs ?? 10_000,
    signal: options.signal,
    onLine: options.onLine,
  });
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ESRCH") {
      return false;
    }
    throw error;
  }
}

async function waitUntilProcessGone(
  pid: number,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return !isProcessAlive(pid);
}

function recordGrandchildPid(lines: readonly string[]): number {
  const pid = Number(lines[0]);
  expect(Number.isInteger(pid)).toBe(true);
  return pid;
}

describe("runLineProcess", () => {
  it("delivers every stdout line and collects stderr", async () => {
    const lines: string[] = [];

    const result = await runNodeScript(
      'console.log("one"); console.log("two"); process.stderr.write("oops");',
      {
        onLine: (line) => {
          lines.push(line);
          return "continue";
        },
      },
    );

    expect(lines).toEqual(["one", "two"]);
    expect(result).toEqual({
      exitCode: 0,
      stderr: "oops",
      spawnErrorCode: null,
      isTimedOut: false,
      isAborted: false,
      isStopped: false,
    });
  });

  it("keeps only the first 4,000 chars of stderr", async () => {
    const result = await runNodeScript(
      'process.stderr.write("e".repeat(10000));',
      { onLine: () => "continue" },
    );

    expect(result.stderr).toBe("e".repeat(4000));
  });

  it("stops after 5 lines of a 10,000-line script", async () => {
    let lineCount = 0;

    const result = await runNodeScript(
      'for (let i = 0; i < 10000; i++) console.log("line " + i);',
      {
        onLine: () => {
          lineCount++;
          return lineCount === 5 ? "stop" : "continue";
        },
      },
    );

    expect(result.isStopped).toBe(true);
    expect(lineCount).toBe(5);
    expect(result.isTimedOut).toBe(false);
    expect(result.isAborted).toBe(false);
  });

  it("times out a script that sleeps 5s", async () => {
    const startedAt = Date.now();

    const result = await runNodeScript("setTimeout(() => {}, 5000);", {
      timeoutMs: 200,
      onLine: () => "continue",
    });

    expect(result.isTimedOut).toBe(true);
    expect(Date.now() - startedAt).toBeLessThan(2000);
  });

  it("aborts a running script", async () => {
    const controller = new AbortController();
    const startedAt = Date.now();

    const result = await runNodeScript(
      'console.log("ready"); setInterval(() => {}, 1000);',
      {
        signal: controller.signal,
        onLine: () => {
          controller.abort();
          return "continue";
        },
      },
    );

    expect(result.isAborted).toBe(true);
    expect(result.isTimedOut).toBe(false);
    expect(Date.now() - startedAt).toBeLessThan(2000);
  });

  it("resolves a pre-aborted signal without spawning", async () => {
    const controller = new AbortController();
    controller.abort();
    let lineCount = 0;

    const result = await runLineProcess({
      command: "devhub-content-search-missing-command",
      args: [],
      cwd: process.cwd(),
      timeoutMs: 10_000,
      signal: controller.signal,
      onLine: () => {
        lineCount++;
        return "continue";
      },
    });

    expect(result).toEqual({
      exitCode: null,
      stderr: "",
      spawnErrorCode: null,
      isTimedOut: false,
      isAborted: true,
      isStopped: false,
    });
    expect(lineCount).toBe(0);
  });

  it("reports ENOENT for a missing command without throwing", async () => {
    const result = await runLineProcess({
      command: "devhub-content-search-missing-command",
      args: ["needle"],
      cwd: process.cwd(),
      timeoutMs: 10_000,
      onLine: () => "continue",
    });

    expect(result.spawnErrorCode).toBe("ENOENT");
    expect(result.exitCode).toBeNull();
    expect(result.isTimedOut).toBe(false);
  });

  it("kills the grandchild process when stopped", async () => {
    const lines: string[] = [];

    const result = await runNodeScript(GRANDCHILD_SCRIPT, {
      onLine: (line) => {
        lines.push(line);
        startedPids.push(Number(line));
        return "stop";
      },
    });

    expect(result.isStopped).toBe(true);
    const grandchildPid = recordGrandchildPid(lines);
    expect(await waitUntilProcessGone(grandchildPid, 2000)).toBe(true);
  });

  it("kills the grandchild process on timeout", async () => {
    const lines: string[] = [];

    const result = await runNodeScript(GRANDCHILD_SCRIPT, {
      timeoutMs: 1000,
      onLine: (line) => {
        lines.push(line);
        startedPids.push(Number(line));
        return "continue";
      },
    });

    expect(result.isTimedOut).toBe(true);
    const grandchildPid = recordGrandchildPid(lines);
    expect(await waitUntilProcessGone(grandchildPid, 2000)).toBe(true);
  });

  it("kills the grandchild process on abort", async () => {
    const controller = new AbortController();
    const lines: string[] = [];

    const result = await runNodeScript(GRANDCHILD_SCRIPT, {
      signal: controller.signal,
      onLine: (line) => {
        lines.push(line);
        startedPids.push(Number(line));
        controller.abort();
        return "continue";
      },
    });

    expect(result.isAborted).toBe(true);
    const grandchildPid = recordGrandchildPid(lines);
    expect(await waitUntilProcessGone(grandchildPid, 2000)).toBe(true);
  });

  it("resolves when stopping a short-lived node process that already exited", async () => {
    for (let iteration = 0; iteration < 5; iteration++) {
      const result = await runNodeScript("console.log('a'); console.log('b')", {
        onLine: stopAfterBlockingEventLoop,
      });

      expect(result.isStopped).toBe(true);
    }
  });

  it("resolves when stopping a short-lived git grep that already exited", async () => {
    const repoDir = makeGitRepoWithTwoMatchingLines();

    for (let iteration = 0; iteration < 5; iteration++) {
      const result = await runLineProcess({
        command: "git",
        args: ["grep", "--untracked", "needle"],
        cwd: repoDir,
        timeoutMs: 15_000,
        onLine: stopAfterBlockingEventLoop,
      });

      expect(result.isStopped).toBe(true);
    }
  });
});
