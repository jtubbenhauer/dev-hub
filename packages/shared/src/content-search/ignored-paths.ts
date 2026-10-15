import { spawn } from "node:child_process";

// Node-only: never export from the @devhub/shared barrel.

export interface FindGitIgnoredPathsInput {
  // Directory the paths are relative to; anywhere inside the work tree.
  readonly cwd: string;
  readonly paths: readonly string[];
  // Remaining search budget; <= 0 skips the check as timed out.
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
}

export type GitIgnoreCheck =
  | { readonly kind: "ignored"; readonly paths: ReadonlySet<string> }
  | { readonly kind: "not-a-repository" }
  | { readonly kind: "unavailable" }
  | { readonly kind: "timed-out" }
  | { readonly kind: "aborted" };

type TerminationReason = "timed-out" | "aborted";

const EXIT_SOME_IGNORED = 0;
const EXIT_NONE_IGNORED = 1;
const MAX_STDERR_CHARS = 1000;
const NOT_A_REPOSITORY_MESSAGE = "not a git repository";

function readErrorCode(error: Error): string | null {
  return "code" in error && typeof error.code === "string" ? error.code : null;
}

function splitNulSeparated(output: Buffer): string[] {
  return output
    .toString("utf8")
    .split("\0")
    .filter((entry) => entry !== "");
}

// Asks git which of `paths` it ignores (.gitignore, info/exclude,
// core.excludesFile). --no-index also reports tracked files matching an
// ignore pattern, which is what rg does when it applies .gitignore.
export function findGitIgnoredPaths(
  input: FindGitIgnoredPathsInput,
): Promise<GitIgnoreCheck> {
  const { cwd, paths, timeoutMs, signal } = input;
  if (signal?.aborted) return Promise.resolve({ kind: "aborted" });
  if (timeoutMs <= 0) return Promise.resolve({ kind: "timed-out" });
  if (paths.length === 0) {
    return Promise.resolve({ kind: "ignored", paths: new Set() });
  }

  return new Promise((resolve) => {
    const isWindows = process.platform === "win32";
    const child = spawn(
      "git",
      ["check-ignore", "--no-index", "-z", "--stdin"],
      {
        cwd,
        shell: false,
        detached: !isWindows,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    const stdoutChunks: Buffer[] = [];
    let stderr = "";
    let isSettled = false;
    let terminationReason: TerminationReason | null = null;

    const timeoutTimer = setTimeout(() => terminate("timed-out"), timeoutMs);

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

    function terminate(reason: TerminationReason): void {
      if (terminationReason !== null) return;
      terminationReason = reason;
      signalTree();
      child.stdin.destroy();
      child.stdout.destroy();
      child.stderr.destroy();
    }

    function handleAbort(): void {
      terminate("aborted");
    }

    function settle(check: GitIgnoreCheck): void {
      if (isSettled) return;
      isSettled = true;
      clearTimeout(timeoutTimer);
      signal?.removeEventListener("abort", handleAbort);
      resolve(check);
    }

    signal?.addEventListener("abort", handleAbort, { once: true });

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      if (stderr.length < MAX_STDERR_CHARS) {
        stderr += chunk.slice(0, MAX_STDERR_CHARS - stderr.length);
      }
    });
    // git may exit (e.g. not a repository) before reading all of stdin; the
    // resulting EPIPE is expected and the exit code decides the outcome.
    child.stdin.on("error", () => undefined);

    child.on("error", () => {
      settle({ kind: "unavailable" });
    });
    child.on("close", (exitCode) => {
      if (terminationReason !== null)
        return settle({ kind: terminationReason });
      switch (exitCode) {
        case EXIT_SOME_IGNORED:
          return settle({
            kind: "ignored",
            paths: new Set(splitNulSeparated(Buffer.concat(stdoutChunks))),
          });
        case EXIT_NONE_IGNORED:
          return settle({ kind: "ignored", paths: new Set() });
        default:
          return settle(
            stderr.includes(NOT_A_REPOSITORY_MESSAGE)
              ? { kind: "not-a-repository" }
              : { kind: "unavailable" },
          );
      }
    });

    child.stdin.end(paths.map((filePath) => `${filePath}\0`).join(""));
  });
}
