// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";

function createMockChildProcess() {
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const child = new EventEmitter() as EventEmitter & {
    pid: number;
    stdout: EventEmitter;
    stderr: EventEmitter;
    killed: boolean;
  };
  child.pid = Math.floor(Math.random() * 10000) + 1000;
  child.stdout = stdout;
  child.stderr = stderr;
  child.killed = false;
  return child;
}

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawn: vi.fn(() => createMockChildProcess()),
  };
});

const spawnMock = vi.mocked(spawn);

import {
  spawnProcess,
  removeProcess,
  getProcess,
  MAX_CONCURRENT_PROCESSES,
} from "@/lib/commands/process-manager";

describe("process-manager concurrent process limit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    for (let i = 0; i < MAX_CONCURRENT_PROCESSES + 5; i++) {
      removeProcess(`s${i}`);
    }
    removeProcess("new-session");
    removeProcess("overflow");
    vi.useRealTimers();
  });

  it("spawnProcess throws when MAX_CONCURRENT_PROCESSES running processes are active", () => {
    for (let i = 0; i < MAX_CONCURRENT_PROCESSES; i++) {
      spawnProcess(`s${i}`, `echo ${i}`, "/tmp", "ws-1");
    }

    expect(() =>
      spawnProcess("overflow", "echo overflow", "/tmp", "ws-1"),
    ).toThrow(
      `Too many concurrent processes (limit: ${MAX_CONCURRENT_PROCESSES}). Kill an existing process first.`,
    );
  });

  it("spawnProcess allows spawning after a process exits", () => {
    const children: ReturnType<typeof createMockChildProcess>[] = [];
    spawnMock.mockImplementation(() => {
      const child = createMockChildProcess();
      children.push(child);
      return child as unknown as ReturnType<typeof spawn>;
    });

    for (let i = 0; i < MAX_CONCURRENT_PROCESSES; i++) {
      spawnProcess(`s${i}`, `echo ${i}`, "/tmp", "ws-1");
    }

    children[0].emit("close", 0);

    expect(() =>
      spawnProcess("new-session", "echo new", "/tmp", "ws-1"),
    ).not.toThrow();
  });

  it("spawnProcess allows replacing an existing session's process (killProcess)", () => {
    for (let i = 0; i < MAX_CONCURRENT_PROCESSES; i++) {
      spawnProcess(`s${i}`, `echo ${i}`, "/tmp", "ws-1");
    }

    expect(() =>
      spawnProcess("s0", "echo replaced", "/tmp", "ws-1"),
    ).not.toThrow();

    const managed = getProcess("s0");
    expect(managed).toBeDefined();
    expect(managed!.command).toBe("echo replaced");
  });
});
