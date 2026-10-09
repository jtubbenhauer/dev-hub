// @vitest-environment node
// allow: SIZE_OK — Task 7 requires the complete lifecycle contract in this single test file.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ChildProcess, spawn, type SpawnOptions } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import { isProcessLive } from "@/tests/helpers/process-liveness";
import {
  LspServerManager,
  LspBusyError,
  getLspServerManager,
} from "@/lib/lsp/server-manager";
import {
  isJsonRpcNotification,
  isJsonRpcRequest,
  isJsonRpcResponse,
  type JsonRpcMessage,
} from "@/lib/lsp/types";

const fixturePath = path.resolve("tests/fixtures/fake-lsp-server.mjs");
const supervisorPath = path.resolve("lib/lsp/lsp-supervisor.mjs");
const resolveServerCommand = () => ({
  command: process.execPath,
  args: [fixturePath],
});
let manager: LspServerManager;
let workspace: { workspaceId: string; workspacePath: string };
let children: ChildProcess[];
let originalExitListeners = process.listeners("exit");
let recordFile: string;
let realGroups: number[];
const fakeChildByPid = new Map<number, ChildProcess>();
const killProcessGroupImpl = vi.fn((pgid: number, signal: NodeJS.Signals) => {
  fakeChildByPid.get(pgid)?.kill(signal);
});

const spawnReal = vi.fn(
  (command: string, args: string[], options: SpawnOptions) => {
    const child = spawn(command, args, options);
    children.push(child);
    if (options.detached && child.pid !== undefined) realGroups.push(child.pid);
    return child;
  },
);

function currentChild() {
  const child = children.at(-1);
  if (!child) throw new Error("Expected a spawned child");
  return child;
}

function childPid() {
  const pid = currentChild().pid;
  if (pid === undefined) throw new Error("Expected a child pid");
  return pid;
}

function connectionToken() {
  const token = manager.attachConnection();
  if (token === null) throw new Error("Expected a free connection");
  return token;
}

function records(): JsonRpcMessage[] {
  return readFileSync(recordFile, "utf8")
    .trim()
    .split("\n")
    .map((line) => {
      const message: unknown = JSON.parse(line);
      if (
        isJsonRpcRequest(message) ||
        isJsonRpcNotification(message) ||
        isJsonRpcResponse(message)
      )
        return message;
      throw new Error("Invalid recorded message");
    });
}

function nextMessage() {
  return new Promise<JsonRpcMessage>((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error("No server message"));
    }, 2_000);
    const unsubscribe = manager.onServerMessage((message) => {
      clearTimeout(timer);
      unsubscribe();
      resolve(message);
    });
  });
}

async function hover(id: number | string = 0) {
  const response = nextMessage();
  manager.sendToServer({ jsonrpc: "2.0", id, method: "textDocument/hover" });
  return response;
}

function controlledSpawn(
  options: NonNullable<ConstructorParameters<typeof LspServerManager>[0]> = {},
) {
  vi.useFakeTimers();
  const spawnImpl = vi.fn(() => {
    const child = new ChildProcess();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    Object.defineProperty(child, "pid", { value: 900_000 + children.length });
    vi.spyOn(child, "kill").mockReturnValue(true);
    children.push(child);
    fakeChildByPid.set(childPid(), child);
    queueMicrotask(() => child.emit("spawn"));
    return child;
  });
  manager = new LspServerManager({
    resolveServerCommand,
    spawnImpl,
    platform: "darwin",
    killProcessGroupImpl,
    ...options,
  });
  return spawnImpl;
}

function frame(message: JsonRpcMessage) {
  const body = JSON.stringify(message);
  return `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;
}

beforeEach(() => {
  originalExitListeners = process.listeners("exit");
  children = [];
  realGroups = [];
  fakeChildByPid.clear();
  killProcessGroupImpl.mockReset();
  killProcessGroupImpl.mockImplementation((pgid, signal) => {
    fakeChildByPid.get(pgid)?.kill(signal);
  });
  spawnReal.mockClear();
  workspace = {
    workspaceId: "workspace A",
    workspacePath: mkdtempSync(path.join(tmpdir(), "devhub-lsp-manager-")),
  };
  recordFile = path.join(workspace.workspacePath, "messages.jsonl");
  for (const key of [
    "FAKE_LSP_EXIT_ON_HOVER",
    "FAKE_LSP_IGNORE_SHUTDOWN",
    "FAKE_LSP_ASK_CONFIG",
    "FAKE_LSP_PID_FILE",
    "FAKE_LSP_SPAWN_GRANDCHILD",
    "FAKE_LSP_GRANDCHILD_PID_FILE",
    "VTSLS_BIN_PATH",
  ])
    vi.stubEnv(key, undefined);
  vi.stubEnv("FAKE_LSP_RECORD_FILE", recordFile);
  manager = new LspServerManager({
    resolveServerCommand,
    spawnImpl: spawnReal,
  });
});

afterEach(async () => {
  if (vi.isFakeTimers()) {
    for (const child of children) child.emit("exit", 0, null);
  }
  try {
    await manager.stop();
  } finally {
    for (const pgid of realGroups) {
      const memberPids = [pgid];
      const grandchildPidFile = path.join(
        workspace.workspacePath,
        "grandchild.pid",
      );
      if (pgid === children.at(-1)?.pid && existsSync(grandchildPidFile)) {
        memberPids.push(Number(readFileSync(grandchildPidFile, "utf8")));
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
  }
  for (const listener of process.listeners("exit")) {
    if (!originalExitListeners.includes(listener))
      process.removeListener("exit", listener);
  }
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rmSync(workspace.workspacePath, { recursive: true, force: true });
}, 20_000);

describe("real stdio lifecycle", () => {
  it("reports a live epoch and exact initialize capabilities when started", async () => {
    await manager.start(workspace);
    const response = nextMessage();
    manager.sendToServer({ jsonrpc: "2.0", id: 0, method: "initialize" });
    expect(await response).toEqual({
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
    expect(process.kill(childPid(), 0)).toBe(true);
    expect(manager.getStatus(workspace.workspaceId, 7601)).toEqual({
      workspaceId: workspace.workspaceId,
      serverEpoch: 1,
      pid: childPid(),
      state: "running",
      wsUrl: "ws://127.0.0.1:7601/?workspaceId=workspace%20A&epoch=1",
      error: null,
    });
    expect(manager.getStatus("other", 7601)).toEqual({
      workspaceId: "other",
      serverEpoch: null,
      pid: null,
      state: "stopped",
      wsUrl: null,
      error: null,
    });
  });

  it("keeps one child when same-workspace starts are concurrent or repeated", async () => {
    await Promise.all([manager.start(workspace), manager.start(workspace)]);
    await manager.start(workspace);
    expect(spawnReal).toHaveBeenCalledTimes(1);
    expect(manager.epoch).toBe(1);
    expect(process.kill(childPid(), 0)).toBe(true);
    expect(spawnReal).toHaveBeenCalledWith(
      process.execPath,
      process.platform === "win32"
        ? [fixturePath, `--clientProcessId=${process.pid}`]
        : [
            supervisorPath,
            `--parent-pid=${process.pid}`,
            "--",
            process.execPath,
            fixturePath,
            `--clientProcessId=${process.pid}`,
          ],
      {
        cwd: workspace.workspacePath,
        stdio: "pipe",
        env: process.env,
        detached: process.platform !== "win32",
      },
    );
  });

  it("replaces the old child when another workspace has no connection", async () => {
    await manager.start(workspace);
    const oldPid = childPid();
    await manager.start({ ...workspace, workspaceId: "B" });
    expect(() => process.kill(oldPid, 0)).toThrow();
    expect(manager.workspaceId).toBe("B");
    expect(manager.epoch).toBe(2);
  });

  it("recovers the queue when a busy start rejects", async () => {
    await manager.start(workspace);
    connectionToken();
    const other = { ...workspace, workspaceId: "B" };
    await expect(manager.start(other)).rejects.toBeInstanceOf(LspBusyError);
    await manager.stop();
    await manager.start(other);
    expect(manager.state).toBe("running");
    expect(manager.workspaceId).toBe("B");
  });

  it("shares the exact stop promise and sends one shutdown when stops overlap", async () => {
    await manager.start(workspace);
    await hover();
    const pid = childPid();
    const started = performance.now();
    const first = manager.stop();
    const second = manager.stop();
    expect(second).toBe(first);
    await first;
    expect(performance.now() - started).toBeLessThanOrEqual(3_000);
    expect(() => process.kill(pid, 0)).toThrow();
    expect(
      records().filter(
        (message) => isJsonRpcRequest(message) && message.method === "shutdown",
      ),
    ).toEqual([
      { jsonrpc: "2.0", id: "devhub-shutdown-1", method: "shutdown" },
    ]);
    expect(manager.state).toBe("stopped");
    expect(manager.workspaceId).toBeNull();
    expect(manager.workspacePath).toBeNull();
  });

  it("starts a fresh epoch when start is issued during stop", async () => {
    await manager.start(workspace);
    const pid = childPid();
    const stop = manager.stop();
    const start = manager.start(workspace);
    await Promise.all([stop, start]);
    expect(manager.state).toBe("running");
    expect(manager.epoch).toBe(2);
    expect(childPid()).not.toBe(pid);
  });

  it("stops after the idle deadline when no connection attaches", async () => {
    manager = new LspServerManager({
      resolveServerCommand,
      noConnectionIdleMs: 200,
      spawnImpl: spawnReal,
    });
    const stopping = new Promise<void>((resolve) =>
      manager.onStopping(resolve),
    );
    await manager.start(workspace);
    await stopping;
    await manager.stop();
    expect(manager.state).toBe("stopped");
  });

  it("cancels idle and rejects a second connection when attached", async () => {
    manager = new LspServerManager({
      resolveServerCommand,
      noConnectionIdleMs: 200,
      spawnImpl: spawnReal,
    });
    await manager.start(workspace);
    connectionToken();
    await delay(250);
    expect(manager.attachConnection()).toBeNull();
    expect(manager.state).toBe("running");
    expect(manager.hasConnection).toBe(true);
  });

  it("stops when the current connection detaches", async () => {
    await manager.start(workspace);
    const token = connectionToken();
    manager.detachConnection(token);
    await manager.stop();
    expect(manager.state).toBe("stopped");
    expect(manager.hasConnection).toBe(false);
  });

  it("keeps the new connection and pid when an old token detaches", async () => {
    await manager.start(workspace);
    const oldToken = connectionToken();
    await manager.stop();
    await manager.start(workspace);
    const token = connectionToken();
    const pid = childPid();
    manager.detachConnection(oldToken);
    await hover();
    expect(token).toBeGreaterThan(oldToken);
    expect(manager.state).toBe("running");
    expect(manager.hasConnection).toBe(true);
    expect(childPid()).toBe(pid);
    expect(process.kill(pid, 0)).toBe(true);
  });

  it("consumes reserved responses while forwarding id zero and supports unsubscribe", async () => {
    await manager.start(workspace);
    const removed = vi.fn();
    manager.onServerMessage(removed)();
    const messages = vi.fn();
    manager.onServerMessage(messages);
    manager.sendToServer({
      jsonrpc: "2.0",
      id: "devhub-hidden",
      method: "textDocument/hover",
    });
    expect(await hover(0)).toEqual({
      jsonrpc: "2.0",
      id: 0,
      result: { contents: "fake-hover" },
    });
    await manager.stop();
    expect(messages).toHaveBeenCalledTimes(1);
    expect(removed).not.toHaveBeenCalled();
  });

  it("records the configuration response when the fixture asks after initialized", async () => {
    vi.stubEnv("FAKE_LSP_ASK_CONFIG", "1");
    await manager.start(workspace);
    const request = nextMessage();
    manager.sendToServer({ jsonrpc: "2.0", method: "initialized" });
    expect(await request).toEqual({
      jsonrpc: "2.0",
      id: "cfg-1",
      method: "workspace/configuration",
      params: { items: [{ section: "typescript.inlayHints" }] },
    });
    const response = { jsonrpc: "2.0", id: "cfg-1", result: [null] } as const;
    manager.sendToServer(response);
    await hover();
    expect(records()).toContainEqual(response);
  });

  it("releases a crashed child before restart and ignores its late socket close", async () => {
    vi.stubEnv("FAKE_LSP_EXIT_ON_HOVER", "1");
    await manager.start(workspace);
    const oldPid = childPid();
    const oldToken = connectionToken();
    const removed = vi.fn();
    manager.onServerExited(removed)();
    const exited = new Promise<void>((resolve) =>
      manager.onServerExited(resolve),
    );
    manager.sendToServer({
      jsonrpc: "2.0",
      id: 0,
      method: "textDocument/hover",
    });
    await exited;
    expect(manager.state).toBe("error");
    expect(manager.error).toBe(
      process.platform === "win32"
        ? "vtsls exited (code 3, signal null)"
        : "vtsls exited (code null, signal SIGKILL)",
    );
    expect(manager.hasConnection).toBe(false);
    expect(removed).not.toHaveBeenCalled();
    vi.stubEnv("FAKE_LSP_EXIT_ON_HOVER", undefined);
    await manager.start(workspace);
    manager.detachConnection(oldToken);
    expect(await hover()).toMatchObject({ result: { contents: "fake-hover" } });
    expect(manager.state).toBe("running");
    expect(manager.epoch).toBe(2);
    expect(childPid()).not.toBe(oldPid);
    expect(process.kill(childPid(), 0)).toBe(true);
    expect(connectionToken()).toBeGreaterThan(oldToken);
  });
});

describe("shutdown escalation", () => {
  it("confirms the real pid is gone before resolving and leaves the replacement alive", async () => {
    vi.stubEnv("FAKE_LSP_IGNORE_SHUTDOWN", "1");
    await manager.start(workspace);
    await hover();
    const oldPid = childPid();
    const exited = vi.fn();
    manager.onServerExited(exited);
    const started = performance.now();
    await manager.stop();
    // The specified waits total 7s before SIGKILL; allow OS exit delivery overhead.
    expect(performance.now() - started).toBeLessThan(7_500);
    expect(() => process.kill(oldPid, 0)).toThrow();
    vi.stubEnv("FAKE_LSP_IGNORE_SHUTDOWN", undefined);
    await manager.start(workspace);
    await delay(3_000);
    expect(manager.state).toBe("running");
    expect(process.kill(childPid(), 0)).toBe(true);
    expect(exited).not.toHaveBeenCalled();
  }, 15_000);

  it("retains an unconfirmed child across retry and start until its exit arrives", async () => {
    const spawnImpl = controlledSpawn();
    await manager.start(workspace);
    const child = currentChild();
    const exited = vi.fn();
    manager.onServerExited(exited);
    const first = manager.stop();
    const firstFailure = expect(first).rejects.toThrow(
      "did not exit after SIGKILL",
    );
    await vi.advanceTimersByTimeAsync(12_000);
    await firstFailure;
    expect(killProcessGroupImpl).toHaveBeenNthCalledWith(
      1,
      child.pid,
      "SIGTERM",
    );
    expect(killProcessGroupImpl).toHaveBeenNthCalledWith(
      2,
      child.pid,
      "SIGKILL",
    );
    expect(manager.state).toBe("error");
    expect(manager.error).toContain("did not exit");
    const second = manager.stop();
    expect(second).not.toBe(first);
    const secondFailure = expect(second).rejects.toThrow(
      "did not exit after SIGKILL",
    );
    await vi.advanceTimersByTimeAsync(5_000);
    await secondFailure;
    expect(killProcessGroupImpl).toHaveBeenNthCalledWith(
      3,
      child.pid,
      "SIGKILL",
    );
    const restartFailure = expect(manager.start(workspace)).rejects.toThrow(
      "previous vtsls process",
    );
    await vi.advanceTimersByTimeAsync(5_000);
    await restartFailure;
    expect(spawnImpl).toHaveBeenCalledTimes(1);
    child.emit("exit", null, "SIGKILL");
    expect(exited).not.toHaveBeenCalled();
    expect(manager.state).toBe("error");
    await manager.start(workspace);
    expect(manager.state).toBe("running");
    expect(spawnImpl).toHaveBeenCalledTimes(2);
  });

  it("ignores every late old-child event when a replacement is running", async () => {
    controlledSpawn();
    await manager.start(workspace);
    const oldChild = currentChild();
    vi.mocked(oldChild.kill).mockImplementation((signal) => {
      if (signal === "SIGTERM") oldChild.emit("exit", null, signal);
      return true;
    });
    const stopped = manager.stop();
    await vi.advanceTimersByTimeAsync(4_000);
    await stopped;
    await manager.start(workspace);
    const exited = vi.fn();
    const messages = vi.fn();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    manager.onServerExited(exited);
    manager.onServerMessage(messages);
    oldChild.emit("spawn");
    oldChild.emit("error", new Error("late"));
    oldChild.emit("exit", 3, null);
    oldChild.stdout?.emit(
      "data",
      Buffer.from(frame({ jsonrpc: "2.0", method: "late" })),
    );
    oldChild.stderr?.emit("data", Buffer.from("late warning\n"));
    await vi.advanceTimersByTimeAsync(0);
    expect(manager.state).toBe("running");
    expect(manager.error).toBeNull();
    expect(manager.epoch).toBe(2);
    expect(exited).not.toHaveBeenCalled();
    expect(messages).not.toHaveBeenCalled();
    expect(warning).not.toHaveBeenCalled();
  });

  it("hides the ws url while a stop is waiting for the child's exit", async () => {
    controlledSpawn();
    await manager.start(workspace);
    const child = currentChild();
    const stopped = manager.stop();
    await vi.advanceTimersByTimeAsync(3_000);
    expect({
      state: manager.state,
      isShuttingDown: manager.isShuttingDown,
      wsUrl: manager.getStatus(workspace.workspaceId, 7601).wsUrl,
    }).toEqual({ state: "running", isShuttingDown: true, wsUrl: null });
    child.emit("exit", 0, null);
    await stopped;
    expect(manager.isShuttingDown).toBe(false);
  });

  it("publishes the ws url again when a start follows the confirmed stop", async () => {
    controlledSpawn();
    await manager.start(workspace);
    const stopped = manager.stop();
    const restarted = manager.start(workspace);
    await vi.advanceTimersByTimeAsync(1_000);
    currentChild().emit("exit", 0, null);
    await Promise.all([stopped, restarted]);
    expect({
      state: manager.state,
      isShuttingDown: manager.isShuttingDown,
      wsUrl: manager.getStatus(workspace.workspaceId, 7601).wsUrl,
    }).toEqual({
      state: "running",
      isShuttingDown: false,
      wsUrl: "ws://127.0.0.1:7601/?workspaceId=workspace%20A&epoch=2",
    });
  });

  it("sets failWithError atomically before the queued restart without calling public stop", async () => {
    const spawnImpl = controlledSpawn();
    await manager.start(workspace);
    const stop = vi.spyOn(manager, "stop");
    const removed = vi.fn();
    manager.onStopping(removed)();
    const failing = manager.failWithError("x");
    const starting = manager.start(workspace);
    const snapshot = failing.then(() => ({
      state: manager.state,
      error: manager.error,
      spawns: spawnImpl.mock.calls.length,
    }));
    await vi.advanceTimersByTimeAsync(0);
    currentChild().emit("exit", 0, null);
    expect(await snapshot).toEqual({ state: "error", error: "x", spawns: 1 });
    await starting;
    expect(stop).not.toHaveBeenCalled();
    expect(removed).not.toHaveBeenCalled();
    expect(manager.state).toBe("running");
    expect(manager.error).toBeNull();
    expect(manager.epoch).toBe(2);
  });

  it("clears a previous failure when stopped without a child", async () => {
    await manager.failWithError("port unavailable");
    expect(manager.state).toBe("error");
    await manager.stop();
    expect(manager.state).toBe("stopped");
    expect(manager.error).toBeNull();
  });

  it("caps complete stderr lines at 200 per epoch", async () => {
    controlledSpawn();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    await manager.start(workspace);
    currentChild().stderr?.emit("data", Buffer.from("part"));
    currentChild().stderr?.emit(
      "data",
      Buffer.from("ial\n" + "line\n".repeat(205)),
    );
    expect(warning).toHaveBeenCalledTimes(200);
    expect(warning).toHaveBeenNthCalledWith(1, "[lsp]", "partial");
    currentChild().emit("exit", 3, null);
    await manager.start(workspace);
    currentChild().stderr?.emit("data", Buffer.from("fresh\n"));
    expect(warning).toHaveBeenLastCalledWith("[lsp]", "fresh");
    expect(warning).toHaveBeenCalledTimes(201);
  });

  it("kills and reports startup timeout when neither spawn nor error arrives", async () => {
    vi.useFakeTimers();
    const child = new ChildProcess();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    Object.defineProperty(child, "pid", { value: 900_000 });
    vi.spyOn(child, "kill").mockReturnValue(true);
    fakeChildByPid.set(900_000, child);
    children.push(child);
    manager = new LspServerManager({
      resolveServerCommand,
      spawnImpl: () => child,
      platform: "darwin",
      killProcessGroupImpl,
    });
    const started = manager.start(workspace);
    await vi.advanceTimersByTimeAsync(0);
    expect(manager.getStatus(workspace.workspaceId, 7601).pid).toBe(900_000);
    await vi.advanceTimersByTimeAsync(10_000);
    await started;
    expect(manager.state).toBe("error");
    expect(manager.error).toBe("vtsls did not start within 10s");
    expect(killProcessGroupImpl).toHaveBeenCalledWith(900_000, "SIGKILL");
    expect(manager.getStatus(workspace.workspaceId, 7601).pid).toBeNull();
    child.emit("spawn");
    expect(manager.state).toBe("error");
  });
});

describe("missing binary", () => {
  it.each(["/nonexistent.js", "missing-vtsls-relative.js"])(
    "resolves %s against the application cwd and never spawns",
    async (binPath) => {
      vi.stubEnv("VTSLS_BIN_PATH", binPath);
      manager = new LspServerManager({ spawnImpl: spawnReal });
      await manager.start(workspace);
      expect(manager.state).toBe("error");
      expect(manager.error).toBe(
        `vtsls not found at ${path.resolve(process.cwd(), binPath)} — run pnpm install`,
      );
      expect(spawnReal).not.toHaveBeenCalled();
      expect(manager.epoch).toBe(0);
      expect(manager.getStatus(workspace.workspaceId, 7601).wsUrl).toBeNull();
    },
  );

  it("uses an absolute override with workspace cwd when the script exists", async () => {
    vi.stubEnv("VTSLS_BIN_PATH", "tests/fixtures/fake-lsp-server.mjs");
    manager = new LspServerManager({ spawnImpl: spawnReal });
    await manager.start(workspace);
    expect(spawnReal).toHaveBeenCalledWith(
      process.execPath,
      process.platform === "win32"
        ? [fixturePath, "--stdio", `--clientProcessId=${process.pid}`]
        : [
            supervisorPath,
            `--parent-pid=${process.pid}`,
            "--",
            process.execPath,
            fixturePath,
            "--stdio",
            `--clientProcessId=${process.pid}`,
          ],
      {
        cwd: workspace.workspacePath,
        stdio: "pipe",
        env: process.env,
        detached: process.platform !== "win32",
      },
    );
    expect(manager.state).toBe("running");
  });

  it("reports a spawn error without poisoning a subsequent stop", async () => {
    manager = new LspServerManager({
      platform: "win32",
      resolveServerCommand: () => ({
        command: "/missing-devhub-executable",
        args: [],
      }),
      spawnImpl: spawnReal,
    });
    await manager.start(workspace);
    expect(manager.state).toBe("error");
    expect(manager.error).toContain("ENOENT");
    await manager.stop();
    expect(manager.state).toBe("stopped");
  });

  it("returns the global singleton and registers its exit hook once", () => {
    const prior = globalThis.__devhubLspServerManager;
    const once = vi.spyOn(process, "once");
    globalThis.__devhubLspServerManager = undefined;
    try {
      expect(getLspServerManager()).toBe(getLspServerManager());
      expect(
        once.mock.calls.filter(([event]) => event === "exit"),
      ).toHaveLength(1);
    } finally {
      globalThis.__devhubLspServerManager = prior;
    }
  });
});

describe("process-tree ownership", () => {
  it.each(["darwin", "win32"] as const)(
    "uses the %s spawn contract",
    async (platform) => {
      // Given
      const customSupervisor = path.join(
        workspace.workspacePath,
        "supervisor.mjs",
      );
      const spawnImpl = controlledSpawn({
        platform,
        parentPid: 4242,
        supervisorPath: customSupervisor,
        resolveServerCommand: () => ({
          command: "custom-vtsls",
          args: ["--stdio"],
        }),
      });
      // When
      await manager.start(workspace);
      // Then
      expect(spawnImpl).toHaveBeenCalledWith(
        platform === "win32" ? "custom-vtsls" : process.execPath,
        platform === "win32"
          ? ["--stdio", "--clientProcessId=4242"]
          : [
              customSupervisor,
              "--parent-pid=4242",
              "--",
              "custom-vtsls",
              "--stdio",
              "--clientProcessId=4242",
            ],
        {
          cwd: workspace.workspacePath,
          stdio: "pipe",
          env: process.env,
          detached: platform !== "win32",
        },
      );
    },
  );

  it("uses direct child signaling when win32 stop escalates", async () => {
    // Given
    controlledSpawn({ platform: "win32" });
    await manager.start(workspace);
    const child = currentChild();
    // When
    const stopped = manager.stop();
    await vi.advanceTimersByTimeAsync(7_000);
    child.emit("exit", null, "SIGKILL");
    await stopped;
    // Then
    expect(child.kill).toHaveBeenNthCalledWith(1, "SIGTERM");
    expect(child.kill).toHaveBeenNthCalledWith(2, "SIGKILL");
    expect(killProcessGroupImpl).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "destroys stdin when the child exits (stopping=%s)",
    async (isStopping) => {
      // Given
      controlledSpawn();
      await manager.start(workspace);
      const child = currentChild();
      const stopped = isStopping ? manager.stop() : Promise.resolve();
      await vi.advanceTimersByTimeAsync(0);
      // When
      child.emit("exit", 0, null);
      await stopped;
      // Then
      expect(child.stdin?.destroyed).toBe(true);
      expect(manager.getStatus(workspace.workspaceId, 7601).pid).toBeNull();
    },
  );

  it("signals the held group synchronously when a child is running", async () => {
    // Given
    controlledSpawn();
    await manager.start(workspace);
    // When
    manager.killProcessTreeSync();
    // Then
    expect(killProcessGroupImpl).toHaveBeenCalledExactlyOnceWith(
      childPid(),
      "SIGKILL",
    );
  });

  it.each([false, true])(
    "never signals a group when no child is held (previous child=%s)",
    async (hasPreviousChild) => {
      // Given
      controlledSpawn();
      if (hasPreviousChild) {
        await manager.start(workspace);
        currentChild().emit("exit", 0, null);
      }
      // When
      manager.killProcessTreeSync();
      // Then
      expect(killProcessGroupImpl).not.toHaveBeenCalled();
    },
  );

  it.each(["ESRCH", "EPERM"])(
    "handles %s when group signaling fails",
    async (code) => {
      // Given
      controlledSpawn();
      await manager.start(workspace);
      const error = Object.assign(new Error("signal failed"), { code });
      killProcessGroupImpl.mockImplementation(() => {
        throw error;
      });
      const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
      // When
      manager.killProcessTreeSync();
      // Then
      expect(warning.mock.calls).toEqual(
        code === "ESRCH" ? [] : [["[lsp] process-group signal failed", error]],
      );
    },
  );

  it("kills the tree synchronously when the manager's process exit hook runs", async () => {
    // Given
    controlledSpawn();
    await manager.start(workspace);
    const kill = vi.spyOn(manager, "killProcessTreeSync");
    const exitHook = process.listeners("exit").at(-1);
    if (!exitHook) throw new Error("Expected manager exit hook");
    // When
    exitHook(0);
    // Then
    expect(kill).toHaveBeenCalledOnce();
    expect(killProcessGroupImpl).toHaveBeenCalledExactlyOnceWith(
      childPid(),
      "SIGKILL",
    );
  });
});

describe.skipIf(process.platform === "win32")("real grandchild cleanup", () => {
  it.each([
    { name: "graceful stop", flag: undefined, run: () => manager.stop() },
    {
      name: "ignored shutdown",
      flag: "FAKE_LSP_IGNORE_SHUTDOWN",
      run: () => manager.stop(),
    },
    {
      name: "hover crash",
      flag: "FAKE_LSP_EXIT_ON_HOVER",
      run: () =>
        new Promise<void>((resolve) => {
          manager.onServerExited(resolve);
          manager.sendToServer({
            jsonrpc: "2.0",
            id: 0,
            method: "textDocument/hover",
          });
        }),
    },
    {
      name: "synchronous tree kill",
      flag: undefined,
      run: () => manager.killProcessTreeSync(),
    },
  ])(
    "removes the live grandchild after $name",
    async ({ flag, run }) => {
      // Given
      const pidFile = path.join(workspace.workspacePath, "grandchild.pid");
      vi.stubEnv("FAKE_LSP_SPAWN_GRANDCHILD", "1");
      vi.stubEnv("FAKE_LSP_GRANDCHILD_PID_FILE", pidFile);
      if (flag) vi.stubEnv(flag, "1");
      await manager.start(workspace);
      await vi.waitFor(() => expect(existsSync(pidFile)).toBe(true), {
        interval: 50,
        timeout: 2_000,
      });
      const grandchildPid = Number(readFileSync(pidFile, "utf8"));
      expect(isProcessLive(grandchildPid)).toBe(true);
      // When
      await run();
      // Then
      await vi.waitFor(() => expect(isProcessLive(grandchildPid)).toBe(false), {
        interval: 50,
        timeout: 3_000,
      });
    },
    10_000,
  );
});
