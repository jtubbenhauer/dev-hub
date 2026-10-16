// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  readBackgroundStatusUpdate,
  toSessionBackgroundStatus,
  type OmoBackgroundStatusKey,
} from "@/lib/omo/adapter/background-status";
import { createLiveAdapter } from "@/lib/omo/adapter/live-events";

function setStatusRecord(statusKey: string, statusText?: string) {
  return {
    type: "extension_ui_request",
    sessionId: "rpc-29",
    id: "ui-1",
    method: "setStatus",
    statusKey,
    ...(statusText === undefined ? {} : { statusText }),
  };
}

function statusFrom(entries: Array<[OmoBackgroundStatusKey, string]>) {
  return toSessionBackgroundStatus(new Map(entries));
}

describe("readBackgroundStatusUpdate", () => {
  it("reads omo's goal, goal-wait and monitors footer statuses", () => {
    expect(
      readBackgroundStatusUpdate(setStatusRecord("goal", "Pursuing goal (5m)")),
    ).toEqual({ key: "goal", text: "Pursuing goal (5m)" });
    expect(
      readBackgroundStatusUpdate(
        setStatusRecord("goal-wait", "▰▱ goal resumes in 3m"),
      ),
    ).toEqual({ key: "goal-wait", text: "▰▱ goal resumes in 3m" });
    expect(
      readBackgroundStatusUpdate(
        setStatusRecord("monitors", "◉ watching e2e gate (3m)"),
      ),
    ).toEqual({ key: "monitors", text: "◉ watching e2e gate (3m)" });
  });

  it("treats a missing or blank status text as clearing that status", () => {
    expect(readBackgroundStatusUpdate(setStatusRecord("goal"))).toEqual({
      key: "goal",
      text: undefined,
    });
    expect(
      readBackgroundStatusUpdate(setStatusRecord("monitors", "  ")),
    ).toEqual({ key: "monitors", text: undefined });
  });

  it("ignores other status keys, other UI methods and other records", () => {
    expect(
      readBackgroundStatusUpdate(setStatusRecord("loop", "Loop 2/5")),
    ).toBeUndefined();
    expect(
      readBackgroundStatusUpdate({
        type: "extension_ui_request",
        id: "ui-2",
        method: "notify",
        message: "Done",
      }),
    ).toBeUndefined();
    expect(
      readBackgroundStatusUpdate({ type: "agent_start", statusKey: "goal" }),
    ).toBeUndefined();
  });
});

describe("toSessionBackgroundStatus", () => {
  it("strips the wait bar into a progress share and reads the check-in", () => {
    expect(
      statusFrom([
        [
          "goal-wait",
          "▰▰▰▱▱▱▱▱▱▱▱▱ goal continues in 4m 30s · 2 wake sources on duty",
        ],
      ]),
    ).toEqual({
      goalWait: "goal continues in 4m 30s · 2 wake sources on duty",
      goalCheckIn: "4m 30s",
      goalWaitProgress: 0.25,
    });
    expect(
      statusFrom([["goal-wait", "▰▰▰▰▰▰▱▱▱▱▱▱ goal resumes in 3m"]]),
    ).toEqual({
      goalWait: "goal resumes in 3m",
      goalCheckIn: "3m",
      goalWaitProgress: 0.5,
    });
  });

  it("keeps a wait line it cannot parse as plain text", () => {
    expect(statusFrom([["goal-wait", "waiting on review"]])).toEqual({
      goalWait: "waiting on review",
    });
  });

  it("strips the watch glyph and counts the monitors", () => {
    expect(
      statusFrom([
        ["monitors", "◉ watching e2e scope gate (11 scenarios x5) (3m)"],
      ]),
    ).toEqual({
      monitors: "watching e2e scope gate (11 scenarios x5) (3m)",
      monitorCount: 1,
    });
    expect(
      statusFrom([
        ["monitors", "◉ watching 2: e2e scope gate, e2e scheduling gate (5m)"],
      ]),
    ).toEqual({
      monitors: "watching 2: e2e scope gate, e2e scheduling gate (5m)",
      monitorCount: 2,
    });
  });

  it("merges every status line and returns null when none is left", () => {
    expect(
      statusFrom([
        ["goal", "Pursuing goal (25m)"],
        ["monitors", "◉ watching e2e gate (1m)"],
      ]),
    ).toEqual({
      goal: "Pursuing goal (25m)",
      goalState: "active",
      monitors: "watching e2e gate (1m)",
      monitorCount: 1,
    });
    expect(statusFrom([])).toBeNull();
  });

  it.each([
    ["Pursuing goal", "active"],
    ["Pursuing goal (1h 5m)", "active"],
    ["Goal paused (/goal resume)", "paused"],
    ["Goal stopped: no progress (send a message or /goal resume)", "stopped"],
    ["Goal blocked", "blocked"],
    ["Goal blocked: waiting on review", "blocked"],
    ["Fix the scope gate… · Goal achieved (12m)", "achieved"],
    ["Ship it · Goal achieved", "achieved"],
    ["· Goal achieved (3m)", "achieved"],
    ["Make Goal paused tests pass · Goal achieved (2m)", "achieved"],
  ])("reads the goal state of %j", (goal, goalState) => {
    expect(statusFrom([["goal", goal]])).toEqual({ goal, goalState });
  });

  it("leaves the goal state out for wording it does not recognise", () => {
    expect(statusFrom([["goal", "Goal achieved early"]])).toEqual({
      goal: "Goal achieved early",
    });
  });
});

describe("createLiveAdapter background statuses", () => {
  it("turns a setStatus record into a background status effect with no events", () => {
    const adapter = createLiveAdapter({
      sessionId: "omo_goal-session",
      workspaceId: "workspace-1",
      workspacePath: "/workspace",
      skillPrefixes: [],
    });

    expect(
      adapter.handle(setStatusRecord("goal", "Pursuing goal (5m)")),
    ).toEqual({
      events: [],
      effects: [
        { backgroundStatus: { key: "goal", text: "Pursuing goal (5m)" } },
      ],
    });
    expect(adapter.handle(setStatusRecord("loop", "Loop 2/5"))).toEqual({
      events: [],
      effects: [],
    });
  });
});
