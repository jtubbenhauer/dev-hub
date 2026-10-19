import { beforeEach, describe, expect, it } from "vitest";
import {
  isBackgroundWorkLive,
  useSessionBackgroundStore,
} from "@/stores/session-background-store";

function backgroundEvent(sessionID: string, status: unknown) {
  return { type: "session.background", properties: { sessionID, status } };
}

function statusOf(sessionId: string) {
  return useSessionBackgroundStore.getState().statusBySession[sessionId];
}

beforeEach(() => {
  useSessionBackgroundStore.setState({ statusBySession: {} });
});

describe("useSessionBackgroundStore", () => {
  it("keeps the latest background status for each session", () => {
    const { handleEvent } = useSessionBackgroundStore.getState();

    handleEvent(backgroundEvent("omo_a", { goal: "Pursuing goal (1m)" }));
    handleEvent(
      backgroundEvent("omo_a", {
        goal: "Pursuing goal (2m)",
        monitors: "watching e2e gate (1m)",
        monitorCount: 1,
      }),
    );
    handleEvent(backgroundEvent("omo_b", { goalWait: "goal resumes in 3m" }));

    expect(statusOf("omo_a")).toEqual({
      goal: "Pursuing goal (2m)",
      monitors: "watching e2e gate (1m)",
      monitorCount: 1,
    });
    expect(statusOf("omo_b")).toEqual({ goalWait: "goal resumes in 3m" });
  });

  it("clears a session when its status is withdrawn or the session is deleted", () => {
    const { handleEvent } = useSessionBackgroundStore.getState();
    handleEvent(backgroundEvent("omo_a", { goal: "Pursuing goal" }));
    handleEvent(backgroundEvent("omo_b", { goal: "Pursuing goal" }));

    handleEvent(backgroundEvent("omo_a", null));
    handleEvent({
      type: "session.deleted",
      properties: { info: { id: "omo_b" } },
    });

    expect(useSessionBackgroundStore.getState().statusBySession).toEqual({});
  });

  it("drops malformed fields and ignores a status with nothing to show", () => {
    const { handleEvent } = useSessionBackgroundStore.getState();

    handleEvent(
      backgroundEvent("omo_a", {
        goalWait: "goal continues in 1m",
        goalWaitProgress: 3,
        monitors: "watching x (1m)",
        monitorCount: 1.5,
      }),
    );
    handleEvent(backgroundEvent("omo_b", { goalCheckIn: "1m" }));

    expect(statusOf("omo_a")).toEqual({
      goalWait: "goal continues in 1m",
      monitors: "watching x (1m)",
    });
    expect(statusOf("omo_b")).toBeUndefined();
  });

  it("keeps each well-formed monitor beside the monitors line", () => {
    const { handleEvent } = useSessionBackgroundStore.getState();
    const ciWatch = {
      id: "bash_1",
      description: "watch checks",
      isPaused: false,
      startedAtMs: 1,
      command: "gh pr checks --watch",
      fireCount: 2,
    };

    handleEvent(
      backgroundEvent("omo_a", {
        monitors: "watching 2: watch checks, deploy (1m)",
        monitorCount: 2,
        monitorEntries: [ciWatch, { id: "bash_2", description: "deploy" }],
      }),
    );
    handleEvent(
      backgroundEvent("omo_b", {
        goal: "Pursuing goal",
        monitorEntries: [ciWatch],
      }),
    );

    expect(statusOf("omo_a")).toEqual({
      monitors: "watching 2: watch checks, deploy (1m)",
      monitorCount: 2,
      monitorEntries: [ciWatch],
    });
    expect(statusOf("omo_b")).toEqual({ goal: "Pursuing goal" });
  });

  it("keeps a known goal state only next to a goal line", () => {
    const { handleEvent } = useSessionBackgroundStore.getState();

    handleEvent(
      backgroundEvent("omo_a", {
        goal: "Goal blocked: waiting on review",
        goalState: "blocked",
      }),
    );
    handleEvent(
      backgroundEvent("omo_b", { goal: "Pursuing goal", goalState: "busy" }),
    );
    handleEvent(
      backgroundEvent("omo_c", {
        goalState: "active",
        monitors: "watching x (1m)",
      }),
    );

    expect(statusOf("omo_a")).toEqual({
      goal: "Goal blocked: waiting on review",
      goalState: "blocked",
    });
    expect(statusOf("omo_b")).toEqual({ goal: "Pursuing goal" });
    expect(statusOf("omo_c")).toEqual({ monitors: "watching x (1m)" });
  });

  it("forgets every status on reset, before a new event stream replays them", () => {
    const { handleEvent, reset } = useSessionBackgroundStore.getState();
    handleEvent(backgroundEvent("omo_a", { goal: "Pursuing goal" }));

    reset();

    expect(useSessionBackgroundStore.getState().statusBySession).toEqual({});
  });

  it("keeps at most 200 sessions and drops the oldest first", () => {
    const { handleEvent } = useSessionBackgroundStore.getState();

    for (let index = 0; index < 201; index += 1) {
      handleEvent(backgroundEvent(`omo_${index}`, { goal: "Pursuing goal" }));
    }

    const tracked = Object.keys(
      useSessionBackgroundStore.getState().statusBySession,
    );
    expect(tracked).toHaveLength(200);
    expect(tracked).not.toContain("omo_0");
    expect(tracked).toContain("omo_200");
  });
});

describe("isBackgroundWorkLive", () => {
  it("counts an active goal, a scheduled check-in or a running monitor as live", () => {
    expect(
      isBackgroundWorkLive({ goal: "Pursuing goal", goalState: "active" }),
    ).toBe(true);
    expect(
      isBackgroundWorkLive({
        goal: "Pursuing goal (5m)",
        goalWait: "goal resumes in 3m",
      }),
    ).toBe(true);
    expect(
      isBackgroundWorkLive({
        goal: "Ship it · Goal achieved (9m)",
        goalState: "achieved",
        monitors: "watching deploy (1m)",
        monitorCount: 1,
      }),
    ).toBe(true);
  });

  it("does not count a goal that is paused, stopped, blocked, achieved or unrecognised", () => {
    for (const goalState of [
      "paused",
      "stopped",
      "blocked",
      "achieved",
    ] as const) {
      expect(isBackgroundWorkLive({ goal: "Goal", goalState })).toBe(false);
    }
    expect(isBackgroundWorkLive({ goal: "Goal achieved early" })).toBe(false);
  });
});
