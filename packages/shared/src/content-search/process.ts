import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

// Node-only: never export from the @devhub/shared barrel.

const MAX_STDERR_CHARS = 4000;

export type LineDecision = "continue" | "stop";

export interface RunLineProcessInput {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
  readonly onLine: (line: string) => LineDecision;
}

export interface RunLineProcessResult {
  readonly exitCode: number | null;
  readonly stderr: string;
  readonly spawnErrorCode: string | null;
  readonly isTimedOut: boolean;
  readonly isAborted: boolean;
  readonly isStopped: boolean;
}

function readErrorCode(error: Error): string | null {
  return "code" in error && typeof error.code === "string" ? error.code : null;
}

export function runLineProcess(
  input: RunLineProcessInput,
): Promise<RunLineProcessResult> {
  const { command, args, cwd, timeoutMs, signal, onLine } = input;

  if (signal?.aborted) {
    return Promise.resolve({
      exitCode: null,
      stderr: "",
      spawnErrorCode: null,
      isTimedOut: false,
      isAborted: true,
      isStopped: false,
    });
  }

  return new Promise((resolve) => {
    const isWindows = process.platform === "win32";
    const child = spawn(command, args, {
      cwd,
      shell: false,
      // Own process group, so the whole tree can be signalled at once.
      detached: !isWindows,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });

    let stderr = "";
    let isSettled = false;
    let isTerminated = false;
    let isTimedOut = false;
    let isAborted = false;
    let isStopped = false;

    const timeoutTimer = setTimeout(() => {
      if (isTerminated) return;
      isTimedOut = true;
      terminate();
    }, timeoutMs);

    function signalTree(killSignal: NodeJS.Signals): void {
      const pid = child.pid;
      if (pid === undefined) return;
      try {
        if (isWindows) child.kill(killSignal);
        else process.kill(-pid, killSignal);
      } catch (error) {
        // ESRCH: group gone. EPERM: macOS, when the leader is an unreaped zombie.
        const code = error instanceof Error ? readErrorCode(error) : null;
        if (code === "ESRCH" || code === "EPERM") return;
        throw error;
      }
    }

    // Search is read-only, so kill immediately: no graceful interval, and no
    // delayed signal that could hit a reused process-group ID after close.
    function terminate(): void {
      isTerminated = true;
      lines.close();
      signalTree("SIGKILL");
      child.stdout.destroy();
      child.stderr.destroy();
    }

    function settle(
      exitCode: number | null,
      spawnErrorCode: string | null,
    ): void {
      if (isSettled) return;
      isSettled = true;
      clearTimeout(timeoutTimer);
      signal?.removeEventListener("abort", handleAbort);
      lines.close();
      resolve({
        exitCode,
        stderr,
        spawnErrorCode,
        isTimedOut,
        isAborted,
        isStopped,
      });
    }

    function handleAbort(): void {
      if (isTerminated) return;
      isAborted = true;
      terminate();
    }

    signal?.addEventListener("abort", handleAbort, { once: true });

    lines.on("line", (line) => {
      if (isTerminated) return;
      if (onLine(line) === "stop") {
        isStopped = true;
        terminate();
      }
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      if (stderr.length < MAX_STDERR_CHARS) {
        stderr += chunk.slice(0, MAX_STDERR_CHARS - stderr.length);
      }
    });

    child.on("error", (error) => {
      settle(null, readErrorCode(error) ?? "UNKNOWN");
    });
    child.on("close", (exitCode) => {
      settle(exitCode, null);
    });
  });
}
