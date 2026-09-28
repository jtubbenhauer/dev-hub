import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { verifyOmoBinary } from "@/lib/omo/binary";
import { ensureOmoDaemon, getOmoDaemonStatus } from "@/lib/omo/daemon";
import { OmoBinaryError } from "@/lib/omo/errors";
import type { JsonlRecord } from "@/lib/omo/jsonl";
import { OmoRpcClient, UnixSocketTransport } from "@/lib/omo/rpc-client";

const PROMPT_TIMEOUT_MS = 60_000;
const CHILD_MODE = "--ensure-child";
const CHILD_READY_LINE = "OMO_ENSURED";

class SmokeAssertionError extends Error {}

type PromptResult =
  | { readonly kind: "pong" }
  | { readonly kind: "skipped"; readonly reason: string };

type PromptWatcher = {
  readonly promise: Promise<void>;
  readonly cancel: () => void;
};

function isRecord(value: unknown): value is JsonlRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function promptFailureReason(record: JsonlRecord): string | undefined {
  const serialized = JSON.stringify(record);
  const isFailure =
    record["success"] === false ||
    record["type"] === "extension_error" ||
    /"error(Message)?"\s*:/.test(serialized);
  return isFailure &&
    /auth|credential|provider|api.?key|model|\/login/i.test(serialized)
    ? "model provider authentication is not configured"
    : undefined;
}

function isPongTextDelta(record: JsonlRecord): boolean {
  if (record["type"] !== "message_update") return false;
  const event = record["assistantMessageEvent"];
  return (
    isRecord(event) &&
    event["type"] === "text_delta" &&
    typeof event["delta"] === "string" &&
    event["delta"].includes("pong")
  );
}

function watchForPong(client: OmoRpcClient, sessionId: string): PromptWatcher {
  let unsubscribe = (): void => undefined;
  let timer: NodeJS.Timeout | undefined;
  const promise = new Promise<void>((resolve, reject) => {
    const finish = (error?: Error): void => {
      if (timer !== undefined) clearTimeout(timer);
      unsubscribe();
      if (error === undefined) resolve();
      else reject(error);
    };
    timer = setTimeout(
      () =>
        finish(
          new SmokeAssertionError(
            "Timed out waiting for an OmO text_delta containing pong",
          ),
        ),
      PROMPT_TIMEOUT_MS,
    );
    unsubscribe = client.onSession(sessionId, (record) => {
      if (isPongTextDelta(record)) {
        finish();
        return;
      }
      const reason = promptFailureReason(record);
      if (reason !== undefined) finish(new SmokeAssertionError(reason));
    });
  });
  void promise.catch(() => undefined);
  return {
    promise,
    cancel: () => {
      if (timer !== undefined) clearTimeout(timer);
      unsubscribe();
    },
  };
}

function promptSkipReason(error: unknown): string | undefined {
  const message = error instanceof Error ? error.message : String(error);
  return /auth|credential|provider|api.?key|model|\/login/i.test(message)
    ? "model provider authentication is not configured"
    : undefined;
}

async function exercisePrompt(
  socketPath: string,
  cwd: string,
): Promise<PromptResult> {
  const client = new OmoRpcClient({
    transport: new UnixSocketTransport({ socketPath }),
  });
  let sessionId: string | undefined;
  try {
    await client.connect();
    const opened = await client.openSession(
      { cwd, retain_on_disconnect: false },
      () => undefined,
    );
    sessionId = opened.sessionId;
    const watcher = watchForPong(client, sessionId);
    try {
      await client.request({
        type: "prompt",
        sessionId,
        message: "Reply with exactly: pong",
      });
      await watcher.promise;
      return { kind: "pong" };
    } catch (error) {
      const reason = promptSkipReason(error);
      if (reason !== undefined) return { kind: "skipped", reason };
      throw error;
    } finally {
      watcher.cancel();
    }
  } finally {
    try {
      if (sessionId !== undefined) {
        await client.request({ type: "close_session", sessionId });
      }
    } finally {
      client.close();
    }
  }
}

function waitForChildReady(child: ChildProcess): Promise<void> {
  const stdout = child.stdout;
  const stderr = child.stderr;
  if (stdout === null || stderr === null) {
    return Promise.reject(
      new SmokeAssertionError("The daemon client child has no output pipes"),
    );
  }

  return new Promise((resolve, reject) => {
    let output = "";
    let errorOutput = "";
    const timer = setTimeout(() => {
      cleanup();
      reject(
        new SmokeAssertionError("Timed out waiting for daemon ensure child"),
      );
    }, 30_000);
    const cleanup = (): void => {
      clearTimeout(timer);
      stdout.off("data", onStdout);
      stderr.off("data", onStderr);
      child.off("error", onError);
      child.off("exit", onExit);
    };
    const onStdout = (chunk: Buffer): void => {
      output += chunk.toString("utf8");
      if (!output.includes(`${CHILD_READY_LINE}\n`)) return;
      cleanup();
      resolve();
    };
    const onStderr = (chunk: Buffer): void => {
      errorOutput += chunk.toString("utf8");
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const onExit = (
      code: number | null,
      signal: NodeJS.Signals | null,
    ): void => {
      cleanup();
      reject(
        new SmokeAssertionError(
          `Daemon ensure child exited before ready (code=${String(code)}, signal=${String(signal)}): ${errorOutput.trim()}`,
        ),
      );
    };
    stdout.on("data", onStdout);
    stderr.on("data", onStderr);
    child.once("error", onError);
    child.once("exit", onExit);
  });
}

function waitForChildExit(child: ChildProcess): Promise<{
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
}> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

async function verifyDaemonSurvivesClientDeath(): Promise<void> {
  const scriptPath = process.argv[1];
  if (scriptPath === undefined) {
    throw new SmokeAssertionError("Cannot resolve the smoke script path");
  }
  const child = spawn(
    process.execPath,
    [...process.execArgv, scriptPath, CHILD_MODE],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  await waitForChildReady(child);
  const exited = waitForChildExit(child);
  if (!child.kill("SIGINT")) {
    throw new SmokeAssertionError(
      "Failed to send SIGINT to daemon client child",
    );
  }
  const exit = await exited;
  if (exit.signal !== "SIGINT" && exit.code !== 130) {
    throw new SmokeAssertionError(
      `Daemon client child did not exit from SIGINT (code=${String(exit.code)}, signal=${String(exit.signal)})`,
    );
  }
  const status = await getOmoDaemonStatus();
  if (!status.reachable) {
    throw new SmokeAssertionError(
      "The shared OmO daemon did not survive daemon client death",
    );
  }
}

async function runEnsureChild(): Promise<void> {
  await ensureOmoDaemon();
  process.stdout.write(`${CHILD_READY_LINE}\n`);
  setInterval(() => undefined, 60_000);
}

async function runSmoke(): Promise<void> {
  try {
    await verifyOmoBinary();
  } catch (error) {
    if (error instanceof OmoBinaryError) {
      console.log("SKIPPED: omo binary is not available");
      return;
    }
    throw error;
  }

  const daemon = await ensureOmoDaemon();
  const cwd = await mkdtemp(join(tmpdir(), "dev-hub-omo-smoke-"));
  let promptResult: PromptResult;
  try {
    promptResult = await exercisePrompt(daemon.socket, cwd);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }

  if (promptResult.kind === "pong") console.log("OK pong");
  else console.log(`SKIPPED: ${promptResult.reason}`);

  await verifyDaemonSurvivesClientDeath();
  console.log("daemon survived");
}

const entrypoint = process.argv.includes(CHILD_MODE)
  ? runEnsureChild
  : runSmoke;
void entrypoint().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
