import { describe, expect, it } from "vitest";
import {
  computeTerminalActivity,
  EMPTY_ACTIVITY_BASELINE,
  formatCommandDuration,
  markTerminalSeen,
} from "@/lib/terminal/terminal-activity";
import type { TerminalSessionInfo } from "@/lib/terminal/terminal-protocol";

function session(overrides: Partial<TerminalSessionInfo>): TerminalSessionInfo {
  return {
    workspaceId: "ws-1",
    sessionId: "a",
    kind: "shell",
    isPinned: false,
    isAttached: false,
    hasExited: false,
    exitCode: null,
    createdAt: 0,
    lastOutputAt: 100,
    runningCommand: null,
    lastFinishedCommand: null,
    idleExpiresAt: null,
    ...overrides,
  };
}

describe("computeTerminalActivity", () => {
  it("treats the first observation as already seen", () => {
    const update = computeTerminalActivity(
      [
        session({
          lastFinishedCommand: {
            name: "make",
            durationMs: 60_000,
            finishedAt: 90,
          },
        }),
      ],
      EMPTY_ACTIVITY_BASELINE,
      null,
    );
    expect(update.unseenActivityKeys).toEqual({});
    expect(update.finishedCommands).toEqual([]);
  });

  it("flags new output in a session the user is not looking at", () => {
    const first = computeTerminalActivity(
      [session({})],
      EMPTY_ACTIVITY_BASELINE,
      null,
    );
    const second = computeTerminalActivity(
      [session({ lastOutputAt: 200 })],
      first.baseline,
      null,
    );
    expect(second.unseenActivityKeys).toEqual({ "ws-1:a": true });
  });

  it("never flags the visible session and clears its flag once viewed", () => {
    const first = computeTerminalActivity(
      [session({})],
      EMPTY_ACTIVITY_BASELINE,
      null,
    );
    const hidden = computeTerminalActivity(
      [session({ lastOutputAt: 200 })],
      first.baseline,
      null,
    );
    const viewed = computeTerminalActivity(
      [session({ lastOutputAt: 200 })],
      hidden.baseline,
      "ws-1:a",
    );
    expect(viewed.unseenActivityKeys).toEqual({});
    const afterViewing = computeTerminalActivity(
      [session({ lastOutputAt: 200 })],
      viewed.baseline,
      null,
    );
    expect(afterViewing.unseenActivityKeys).toEqual({});
  });

  it("does not flag output the user watched before looking away", () => {
    const first = computeTerminalActivity(
      [session({ lastOutputAt: 100 })],
      EMPTY_ACTIVITY_BASELINE,
      "ws-1:a",
    );
    const lookedAway = markTerminalSeen(first.baseline, "ws-1:a", 150);
    const update = computeTerminalActivity(
      [session({ lastOutputAt: 140 })],
      lookedAway,
      null,
    );
    expect(update.unseenActivityKeys).toEqual({});
  });

  it("reports long commands that finish out of view, once", () => {
    const first = computeTerminalActivity(
      [session({})],
      EMPTY_ACTIVITY_BASELINE,
      null,
    );
    const finished = session({
      lastFinishedCommand: {
        name: "pnpm",
        durationMs: 42_000,
        finishedAt: 500,
      },
    });
    const update = computeTerminalActivity([finished], first.baseline, null);
    expect(update.finishedCommands).toHaveLength(1);
    expect(update.finishedCommands[0].command.name).toBe("pnpm");

    const repeat = computeTerminalActivity([finished], update.baseline, null);
    expect(repeat.finishedCommands).toEqual([]);
  });

  it("ignores short commands and commands finished in the visible session", () => {
    const first = computeTerminalActivity(
      [session({})],
      EMPTY_ACTIVITY_BASELINE,
      null,
    );
    const short = computeTerminalActivity(
      [
        session({
          lastFinishedCommand: { name: "ls", durationMs: 200, finishedAt: 500 },
        }),
      ],
      first.baseline,
      null,
    );
    expect(short.finishedCommands).toEqual([]);

    const visible = computeTerminalActivity(
      [
        session({
          lastFinishedCommand: {
            name: "make",
            durationMs: 60_000,
            finishedAt: 600,
          },
        }),
      ],
      short.baseline,
      "ws-1:a",
    );
    expect(visible.finishedCommands).toEqual([]);
  });
});

describe("formatCommandDuration", () => {
  it.each([
    [4_000, "4s"],
    [72_000, "1m 12s"],
    [3_720_000, "1h 2m"],
  ])("formats %i ms as %s", (ms, label) => {
    expect(formatCommandDuration(ms)).toBe(label);
  });
});
