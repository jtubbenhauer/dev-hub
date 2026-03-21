import { spawn, type ChildProcess } from "node:child_process";
import type { ActiveProcess } from "@/lib/commands/types";

const OUTPUT_BUFFER_MAX_LINES = 500;

export interface ManagedProcess {
  process: ChildProcess;
  command: string;
  workspaceId: string;
  startedAt: number;
  outputBuffer: string[];
  exitCode: number | null;
  exited: boolean;
  listeners: Set<(event: string) => void>;
}

const processes = new Map<string, ManagedProcess>();

function formatSSEEvent(eventType: string, data: unknown): string {
  return `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function spawnProcess(
  sessionId: string,
  command: string,
  cwd: string,
  workspaceId: string,
): void {
  killProcess(sessionId);

  const child = spawn(command, {
    cwd,
    shell: true,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, FORCE_COLOR: "1", TERM: "xterm-256color" },
  });

  const managed: ManagedProcess = {
    process: child,
    command,
    workspaceId,
    startedAt: Date.now(),
    outputBuffer: [],
    exitCode: null,
    exited: false,
    listeners: new Set(),
  };

  processes.set(sessionId, managed);

  const pushOutput = (chunk: string) => {
    managed.outputBuffer.push(chunk);
    if (managed.outputBuffer.length > OUTPUT_BUFFER_MAX_LINES) {
      managed.outputBuffer.splice(
        0,
        managed.outputBuffer.length - OUTPUT_BUFFER_MAX_LINES,
      );
    }
    const event = formatSSEEvent("data", { data: chunk });
    for (const listener of managed.listeners) {
      listener(event);
    }
  };

  child.stdout?.on("data", (buf: Buffer) => pushOutput(buf.toString()));
  child.stderr?.on("data", (buf: Buffer) => pushOutput(buf.toString()));

  child.on("error", (err) => {
    managed.exited = true;
    const event = formatSSEEvent("error", { message: err.message });
    for (const listener of managed.listeners) {
      listener(event);
    }
  });

  child.on("close", (code) => {
    managed.exitCode = code;
    managed.exited = true;
    const event = formatSSEEvent("exit", { exitCode: code });
    for (const listener of managed.listeners) {
      listener(event);
    }
    // Auto-remove from map after 60s so exited processes don't accumulate
    setTimeout(() => processes.delete(sessionId), 60_000);
  });
}

export function killProcess(sessionId: string): boolean {
  const managed = processes.get(sessionId);
  if (!managed) return false;

  if (!managed.exited && managed.process.pid) {
    try {
      process.kill(-managed.process.pid, "SIGTERM");
    } catch {
      // Process group may have already exited
    }
    setTimeout(() => {
      if (!managed.exited && managed.process.pid) {
        try {
          process.kill(-managed.process.pid, "SIGKILL");
        } catch {
          // Process group may have already exited
        }
      }
    }, 3000);
  }

  return true;
}

export function removeProcess(sessionId: string): void {
  processes.delete(sessionId);
}

export function getProcess(sessionId: string): ManagedProcess | undefined {
  return processes.get(sessionId);
}

export function subscribe(
  sessionId: string,
  listener: (event: string) => void,
): (() => void) | null {
  const managed = processes.get(sessionId);
  if (!managed) return null;

  managed.listeners.add(listener);
  return () => {
    managed.listeners.delete(listener);
  };
}

export function getOutputBuffer(sessionId: string): string[] {
  return processes.get(sessionId)?.outputBuffer ?? [];
}

export function listActiveProcesses(): ActiveProcess[] {
  const result: ActiveProcess[] = [];
  for (const [sessionId, managed] of processes) {
    result.push({
      sessionId,
      command: managed.command,
      workspaceId: managed.workspaceId,
      pid: managed.process.pid,
      startedAt: managed.startedAt,
      exited: managed.exited,
      exitCode: managed.exitCode,
    });
  }
  return result;
}

export function isRunning(sessionId: string): boolean {
  const managed = processes.get(sessionId);
  return managed !== undefined && !managed.exited;
}
