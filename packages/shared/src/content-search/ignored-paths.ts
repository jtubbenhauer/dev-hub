import { spawn } from "node:child_process";

// Node-only: never export from the @devhub/shared barrel.

export interface FindGitIgnoredPathsInput {
  // Directory the paths are relative to; anywhere inside the work tree.
  readonly cwd: string;
  readonly paths: readonly string[];
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
}

const EXIT_SOME_IGNORED = 0;
const EXIT_NONE_IGNORED = 1;

function readErrorCode(error: Error): string | null {
  return "code" in error && typeof error.code === "string" ? error.code : null;
}

function splitNulSeparated(output: Buffer): string[] {
  return output
    .toString("utf8")
    .split("\0")
    .filter((entry) => entry !== "");
}

// Resolves the subset of `paths` git would ignore (.gitignore, info/exclude,
// core.excludesFile). Resolves null when that can't be determined: not a git
// repository, git missing, timeout or abort.
export function findGitIgnoredPaths(
  input: FindGitIgnoredPathsInput,
): Promise<ReadonlySet<string> | null> {
  const { cwd, paths, timeoutMs, signal } = input;
  if (paths.length === 0) return Promise.resolve(new Set());
  if (signal?.aborted) return Promise.resolve(null);

  return new Promise((resolve) => {
    const isWindows = process.platform === "win32";
    const child = spawn("git", ["check-ignore", "-z", "--stdin"], {
      cwd,
      shell: false,
      detached: !isWindows,
      stdio: ["pipe", "pipe", "ignore"],
    });
    const stdoutChunks: Buffer[] = [];
    let isSettled = false;
    let isTerminated = false;

    const timeoutTimer = setTimeout(terminate, timeoutMs);

    function signalTree(): void {
      const pid = child.pid;
      if (pid === undefined) return;
      try {
        if (isWindows) child.kill("SIGKILL");
        else process.kill(-pid, "SIGKILL");
      } catch (error) {
        // ESRCH: group gone. EPERM: macOS, when the leader is an unreaped zombie.
        const code = error instanceof Error ? readErrorCode(error) : null;
        if (code === "ESRCH" || code === "EPERM") return;
        throw error;
      }
    }

    function terminate(): void {
      if (isTerminated) return;
      isTerminated = true;
      signalTree();
      child.stdin.destroy();
      child.stdout.destroy();
    }

    function settle(ignoredPaths: ReadonlySet<string> | null): void {
      if (isSettled) return;
      isSettled = true;
      clearTimeout(timeoutTimer);
      signal?.removeEventListener("abort", terminate);
      resolve(ignoredPaths);
    }

    signal?.addEventListener("abort", terminate, { once: true });

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });
    // git may exit (e.g. not a repository) before reading all of stdin; the
    // resulting EPIPE is expected and the exit code decides the outcome.
    child.stdin.on("error", () => undefined);

    child.on("error", () => {
      settle(null);
    });
    child.on("close", (exitCode) => {
      if (isTerminated) return settle(null);
      switch (exitCode) {
        case EXIT_SOME_IGNORED:
          return settle(
            new Set(splitNulSeparated(Buffer.concat(stdoutChunks))),
          );
        case EXIT_NONE_IGNORED:
          return settle(new Set());
        default:
          return settle(null);
      }
    });

    child.stdin.end(paths.map((filePath) => `${filePath}\0`).join(""));
  });
}
