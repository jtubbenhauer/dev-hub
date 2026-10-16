// @vitest-environment node

import { afterEach, describe, expect, it } from "vitest";
import { createOmoWorkspaceEventStream } from "@/lib/omo/event-stream";
import {
  attachFixtureSession,
  parseSseFrame,
  readSseFrame,
} from "@/tests/lib/omo/event-stream-fixture";
import {
  createRegistryFixture,
  entriesFixture,
  openFixture,
  type RegistryFixture,
} from "@/tests/lib/omo/session-registry-fixture";

function setStatus(statusKey: string, statusText?: string) {
  return {
    type: "extension_ui_request",
    sessionId: "route-goal",
    id: `ui-${statusKey}`,
    method: "setStatus",
    statusKey,
    ...(statusText === undefined ? {} : { statusText }),
  };
}

function backgroundFrame(status: Record<string, unknown> | null) {
  return {
    workspaceId: "workspace-1",
    event: {
      type: "session.background",
      properties: { sessionID: "omo_goal", status },
    },
  };
}

describe("omo background statuses on the workspace event stream", () => {
  let fixture: RegistryFixture | undefined;
  const disposers: Array<() => void> = [];

  afterEach(async () => {
    for (const dispose of disposers.splice(0)) dispose();
    await fixture?.close();
    fixture = undefined;
  });

  async function attachGoalSession(): Promise<RegistryFixture> {
    const created = await createRegistryFixture([
      openFixture({ durableId: "goal", sessionPath: "/sessions/goal.jsonl" }),
      entriesFixture([], null),
    ]);
    fixture = created;
    await attachFixtureSession(created, "goal");
    return created;
  }

  function openStream(current: RegistryFixture) {
    const eventStream = createOmoWorkspaceEventStream({
      workspace: current.workspace,
      runtime: current.runtime,
      signal: new AbortController().signal,
    });
    disposers.push(eventStream.dispose);
    return eventStream.stream.getReader();
  }

  it("streams the goal and monitor lines as one merged status", async () => {
    // Given
    const current = await attachGoalSession();
    const reader = openStream(current);

    // When
    current.host.emit(setStatus("goal", "Pursuing goal (5m)"));
    current.host.emit(setStatus("monitors", "◉ watching e2e gate (3m)"));

    // Then
    expect(parseSseFrame(await readSseFrame(reader))).toEqual(
      backgroundFrame({ goal: "Pursuing goal (5m)", goalState: "active" }),
    );
    expect(parseSseFrame(await readSseFrame(reader))).toEqual(
      backgroundFrame({
        goal: "Pursuing goal (5m)",
        goalState: "active",
        monitors: "watching e2e gate (3m)",
        monitorCount: 1,
      }),
    );
  });

  it("replays a live status to a stream that starts later", async () => {
    // Given
    const current = await attachGoalSession();
    const firstReader = openStream(current);
    current.host.emit(setStatus("goal", "Pursuing goal (5m)"));
    await readSseFrame(firstReader);

    // When
    const laterReader = openStream(current);

    // Then
    expect(parseSseFrame(await readSseFrame(laterReader))).toEqual(
      backgroundFrame({ goal: "Pursuing goal (5m)", goalState: "active" }),
    );
  });

  it("withdraws the status once its last line clears", async () => {
    // Given
    const current = await attachGoalSession();
    const reader = openStream(current);
    current.host.emit(setStatus("goal", "Pursuing goal (5m)"));
    await readSseFrame(reader);

    // When
    current.host.emit(setStatus("goal"));

    // Then
    expect(parseSseFrame(await readSseFrame(reader))).toEqual(
      backgroundFrame(null),
    );
    expect(
      current.runtime.registry.backgroundStatusesForWorkspace("workspace-1"),
    ).toEqual({});
  });

  it("withdraws the status when the omo connection drops", async () => {
    // Given
    const current = await attachGoalSession();
    const reader = openStream(current);
    current.host.emit(setStatus("goal", "Pursuing goal (5m)"));
    await readSseFrame(reader);

    // When
    current.host.dropAll();

    // Then
    const frames = [
      parseSseFrame(await readSseFrame(reader)),
      parseSseFrame(await readSseFrame(reader)),
    ];
    expect(frames).toContainEqual(backgroundFrame(null));
    expect(
      current.runtime.registry.backgroundStatusesForWorkspace("workspace-1"),
    ).toEqual({});
  });
});
