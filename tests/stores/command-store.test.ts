import { describe, it, expect, beforeEach, vi } from "vitest";
import { useCommandStore } from "@/stores/command-store";
import type { ActiveProcess } from "@/lib/commands/types";

// The command store uses a module-level `flushHandle` that is set via
// requestAnimationFrame.  The global rAF shim (tests/setup.ts) runs the
// callback synchronously — which clears flushHandle to null — but then
// returns 0.  The assignment `flushHandle = requestAnimationFrame(...)` thus
// leaves flushHandle as 0, which is !== null, causing subsequent
// scheduleFlush calls to bail early.  Override rAF here to return null
// (cast to number) so flushHandle stays null after each synchronous flush.
globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
  cb(performance.now());
  return null as unknown as number;
};

function resetStore() {
  useCommandStore.setState({
    sessions: {},
    activeSessionId: null,
    isDrawerOpen: false,
  });
}

describe("setDrawerOpen", () => {
  beforeEach(resetStore);

  it("toggles the drawer state", () => {
    expect(useCommandStore.getState().isDrawerOpen).toBe(false);
    useCommandStore.getState().setDrawerOpen(true);
    expect(useCommandStore.getState().isDrawerOpen).toBe(true);
    useCommandStore.getState().setDrawerOpen(false);
    expect(useCommandStore.getState().isDrawerOpen).toBe(false);
  });
});

describe("setActiveSessionId", () => {
  beforeEach(resetStore);

  it("sets the active session", () => {
    useCommandStore.getState().setActiveSessionId("s1");
    expect(useCommandStore.getState().activeSessionId).toBe("s1");
  });

  it("clears the active session with null", () => {
    useCommandStore.getState().setActiveSessionId("s1");
    useCommandStore.getState().setActiveSessionId(null);
    expect(useCommandStore.getState().activeSessionId).toBeNull();
  });
});

describe("runCommand", () => {
  beforeEach(() => {
    resetStore();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 200 }),
    );
  });

  it("creates a session and returns a session id", () => {
    const sessionId = useCommandStore.getState().runCommand("ls -la", "ws-1");

    expect(typeof sessionId).toBe("string");
    expect(sessionId.length).toBeGreaterThan(0);

    const session = useCommandStore.getState().sessions[sessionId];
    expect(session).toBeDefined();
    expect(session.command).toBe("ls -la");
    expect(session.workspaceId).toBe("ws-1");
    expect(session.isRunning).toBe(true);
    expect(session.exitCode).toBeNull();
    expect(session.lines).toEqual([]);
  });

  it("sets the new session as active", () => {
    const sessionId = useCommandStore.getState().runCommand("echo hi", "ws-1");
    expect(useCommandStore.getState().activeSessionId).toBe(sessionId);
  });

  it("creates unique session ids for multiple commands", () => {
    const id1 = useCommandStore.getState().runCommand("cmd1", "ws-1");
    const id2 = useCommandStore.getState().runCommand("cmd2", "ws-1");

    expect(id1).not.toBe(id2);
    expect(Object.keys(useCommandStore.getState().sessions)).toHaveLength(2);
  });
});

describe("removeSession", () => {
  beforeEach(() => {
    resetStore();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 200 }),
    );
  });

  it("removes the session from the store", () => {
    const sessionId = useCommandStore.getState().runCommand("test", "ws-1");
    useCommandStore.getState().removeSession(sessionId);

    expect(useCommandStore.getState().sessions[sessionId]).toBeUndefined();
  });

  it("clears activeSessionId when removing the active session", () => {
    const sessionId = useCommandStore.getState().runCommand("test", "ws-1");
    expect(useCommandStore.getState().activeSessionId).toBe(sessionId);

    useCommandStore.getState().removeSession(sessionId);
    expect(useCommandStore.getState().activeSessionId).toBeNull();
  });

  it("preserves activeSessionId when removing a non-active session", () => {
    const id1 = useCommandStore.getState().runCommand("cmd1", "ws-1");
    const id2 = useCommandStore.getState().runCommand("cmd2", "ws-1");
    // id2 is active (last run)
    expect(useCommandStore.getState().activeSessionId).toBe(id2);

    useCommandStore.getState().removeSession(id1);
    expect(useCommandStore.getState().activeSessionId).toBe(id2);
    expect(useCommandStore.getState().sessions[id1]).toBeUndefined();
    expect(useCommandStore.getState().sessions[id2]).toBeDefined();
  });

  it("fires a DELETE request for server-side cleanup", () => {
    const sessionId = useCommandStore.getState().runCommand("test", "ws-1");
    const fetchSpy = vi.mocked(globalThis.fetch);
    fetchSpy.mockClear();

    useCommandStore.getState().removeSession(sessionId);

    const deleteCall = fetchSpy.mock.calls.find(
      ([url, opts]) =>
        typeof url === "string" &&
        url.includes(sessionId) &&
        (opts as RequestInit)?.method === "DELETE",
    );
    expect(deleteCall).toBeDefined();
  });
});

describe("killCommand", () => {
  beforeEach(() => {
    resetStore();
    // streamFromServer's POST must hang so it doesn't race with killCommand
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.includes("/api/commands/run")) {
        return new Promise(() => {});
      }
      return Promise.resolve(new Response(null, { status: 200 }));
    });
  });

  it("sends a kill request and marks the session as exited", async () => {
    const sessionId = useCommandStore.getState().runCommand("long-cmd", "ws-1");

    await useCommandStore.getState().killCommand(sessionId);

    const session = useCommandStore.getState().sessions[sessionId];
    expect(session.isRunning).toBe(false);
    expect(session.exitCode).toBeNull();
  });

  it("appends a 'process killed' line to the session", async () => {
    const sessionId = useCommandStore.getState().runCommand("cmd", "ws-1");

    await useCommandStore.getState().killCommand(sessionId);

    const session = useCommandStore.getState().sessions[sessionId];
    const hasKillLine = session.lines.some((line) =>
      line.includes("process killed"),
    );
    expect(hasKillLine).toBe(true);
  });

  it("is idempotent — killing an already-exited session is a no-op", async () => {
    const sessionId = useCommandStore.getState().runCommand("cmd", "ws-1");
    await useCommandStore.getState().killCommand(sessionId);

    const linesAfterFirstKill =
      useCommandStore.getState().sessions[sessionId].lines.length;
    await useCommandStore.getState().killCommand(sessionId);

    expect(useCommandStore.getState().sessions[sessionId].lines.length).toBe(
      linesAfterFirstKill,
    );
  });
});

describe("reconnectToProcess", () => {
  beforeEach(resetStore);

  it("adds a running session with a background notice", () => {
    const proc: ActiveProcess = {
      sessionId: "srv-1",
      command: "npm start",
      workspaceId: "ws-1",
      pid: 12345,
      startedAt: Date.now(),
      exited: false,
      exitCode: null,
    };

    useCommandStore.getState().reconnectToProcess(proc);

    const session = useCommandStore.getState().sessions["srv-1"];
    expect(session).toBeDefined();
    expect(session.command).toBe("npm start");
    expect(session.workspaceId).toBe("ws-1");
    expect(session.isRunning).toBe(true);
    expect(session.lines[0]).toContain("running in background");
  });
});

describe("fetchActiveProcesses", () => {
  beforeEach(() => {
    resetStore();
  });

  it("adds exited processes as finished sessions", async () => {
    const processes: ActiveProcess[] = [
      {
        sessionId: "srv-done",
        command: "echo done",
        workspaceId: "ws-1",
        pid: 111,
        startedAt: Date.now(),
        exited: true,
        exitCode: 0,
      },
    ];

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ processes }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await useCommandStore.getState().fetchActiveProcesses();

    const session = useCommandStore.getState().sessions["srv-done"];
    expect(session).toBeDefined();
    expect(session.isRunning).toBe(false);
    expect(session.exitCode).toBe(0);
    expect(session.command).toBe("echo done");
  });

  it("reconnects running processes", async () => {
    const processes: ActiveProcess[] = [
      {
        sessionId: "srv-running",
        command: "npm start",
        workspaceId: "ws-1",
        pid: 222,
        startedAt: Date.now(),
        exited: false,
        exitCode: null,
      },
    ];

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ processes }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await useCommandStore.getState().fetchActiveProcesses();

    const session = useCommandStore.getState().sessions["srv-running"];
    expect(session).toBeDefined();
    expect(session.isRunning).toBe(true);
  });

  it("skips processes that already exist in sessions", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 200 }),
    );

    const sessionId = useCommandStore.getState().runCommand("existing", "ws-1");

    const processes: ActiveProcess[] = [
      {
        sessionId,
        command: "existing",
        workspaceId: "ws-1",
        pid: 333,
        startedAt: Date.now(),
        exited: false,
        exitCode: null,
      },
    ];

    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(JSON.stringify({ processes }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await useCommandStore.getState().fetchActiveProcesses();

    // Session should still be the original (isRunning from runCommand, not reconnect)
    const session = useCommandStore.getState().sessions[sessionId];
    expect(session.command).toBe("existing");
    // Should NOT have the "running in background" message
    expect(session.lines.some((l) => l.includes("running in background"))).toBe(
      false,
    );
  });

  it("handles fetch failures gracefully", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network error"));

    await useCommandStore.getState().fetchActiveProcesses();

    expect(Object.keys(useCommandStore.getState().sessions)).toHaveLength(0);
  });

  it("handles non-ok responses gracefully", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 500 }),
    );

    await useCommandStore.getState().fetchActiveProcesses();

    expect(Object.keys(useCommandStore.getState().sessions)).toHaveLength(0);
  });
});
