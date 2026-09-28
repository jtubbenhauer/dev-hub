// @vitest-environment node

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createLiveAdapter } from "@/lib/omo/adapter/live-events";
import type { LiveAdapterResult } from "@/lib/omo/adapter/live-events";
import type { JsonlRecord } from "@/lib/omo/jsonl";
import type { Event, ToolPart } from "@/lib/opencode/types";

const FIXTURE_DIRECTORY = join(process.cwd(), "tests/fixtures/omo");
const OPTIONS = {
  sessionId: "omo_durable-subagent-parent-1",
  workspaceId: "workspace-1",
  workspacePath: "/workspace",
  skillPrefixes: ["frontend", "debugging"],
} as const;

interface TaskFixtureMetadata {
  readonly agentType: string;
  readonly childRawId: string;
  readonly parentRawId: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readFixture(name: string): JsonlRecord[] {
  return readFileSync(join(FIXTURE_DIRECTORY, `${name}.jsonl`), "utf8")
    .trim()
    .split("\n")
    .map((line) => {
      const parsed: unknown = JSON.parse(line);
      if (!isRecord(parsed))
        throw new TypeError("fixture line is not a record");
      return parsed;
    });
}

function replay(records: readonly JsonlRecord[]): LiveAdapterResult[] {
  const adapter = createLiveAdapter(OPTIONS);
  return records.map((record) => adapter.handle(record));
}

function replayFixture(name: string): LiveAdapterResult[] {
  return replay(readFixture(name));
}

function allEvents(results: readonly LiveAdapterResult[]): Event[] {
  return results.flatMap((result) => result.events);
}

function updatedToolParts(events: readonly Event[]): ToolPart[] {
  return events.flatMap((event) =>
    event.type === "message.part.updated" &&
    event.properties.part.type === "tool"
      ? [event.properties.part]
      : [],
  );
}

function taskFixtureMetadata(
  records: readonly JsonlRecord[],
): TaskFixtureMetadata {
  for (const record of records) {
    if (record["type"] !== "extension_event" || !isRecord(record["data"])) {
      continue;
    }
    const data = record["data"];
    const task = Array.isArray(data["tasks"]) ? data["tasks"].at(0) : undefined;
    if (
      typeof data["parent_session_id"] === "string" &&
      isRecord(task) &&
      typeof task["agent_type"] === "string" &&
      typeof task["child_session_id"] === "string"
    ) {
      return {
        agentType: task["agent_type"],
        childRawId: task["child_session_id"],
        parentRawId: data["parent_session_id"],
      };
    }
  }
  throw new TypeError("task fixture has no child session metadata");
}

describe("createLiveAdapter tool events", () => {
  it("moves a fixture tool part from pending through running to completed", () => {
    const events = allEvents(replayFixture("tool-call"));
    const toolParts = updatedToolParts(events);
    const transitions = toolParts
      .map((part) => part.state.status)
      .filter((status, index, statuses) => statuses[index - 1] !== status);
    const completed = toolParts.find(
      (part) => part.state.status === "completed",
    );

    expect(transitions).toEqual(["pending", "running", "completed"]);
    expect(completed).toMatchObject({
      tool: "read",
      state: {
        status: "completed",
        input: { path: "/TMP/hello.txt" },
        output: "hello from fixture\n",
        metadata: {},
        time: {
          start: Date.parse("2026-09-28T10:01:00.070Z"),
          end: Date.parse("2026-09-28T10:01:00.080Z"),
        },
      },
    });
  });

  it("replaces running tool output on each execution update", () => {
    const adapter = createLiveAdapter(OPTIONS);
    adapter.handle({
      type: "message_start",
      message: { role: "assistant", content: [], timestamp: 1_000 },
    });
    adapter.handle({
      type: "message_update",
      assistantMessageEvent: {
        type: "toolcall_start",
        contentIndex: 0,
        id: "call-update-1",
        toolName: "read",
      },
    });
    adapter.handle({
      type: "tool_execution_start",
      toolCallId: "call-update-1",
      toolName: "read",
      args: { path: "/workspace/file.txt" },
      timestamp: 1_010,
    });

    const first = adapter.handle({
      type: "tool_execution_update",
      toolCallId: "call-update-1",
      partialResult: { content: [{ type: "text", text: "first output" }] },
      timestamp: 1_020,
    });
    const second = adapter.handle({
      type: "tool_execution_update",
      toolCallId: "call-update-1",
      partialResult: { content: [{ type: "text", text: "replacement" }] },
      timestamp: 1_030,
    });

    expect(updatedToolParts(first.events)[0]).toMatchObject({
      state: { status: "running", output: "first output" },
    });
    expect(updatedToolParts(second.events)[0]).toMatchObject({
      state: { status: "running", output: "replacement" },
    });
  });

  it("maps task children to sessions, parent tool metadata, and one index effect", () => {
    const records = readFixture("task-subagent");
    const fixture = taskFixtureMetadata(records);
    const results = replay(records);
    const events = allEvents(results);
    const childSessionId = `omo_${fixture.childRawId}`;
    const created = events.find((event) => event.type === "session.created");
    const taskPart = updatedToolParts(events).find((part) => {
      const metadata =
        "metadata" in part.state ? part.state.metadata : undefined;
      return metadata?.["sessionId"] === childSessionId;
    });
    const mergeEffects = results
      .flatMap((result) => result.effects)
      .filter((effect) => "mergeFromTaskEvent" in effect);

    expect(created).toMatchObject({
      type: "session.created",
      properties: {
        info: {
          id: childSessionId,
          parentID: `omo_${fixture.parentRawId}`,
          projectID: OPTIONS.workspaceId,
          directory: OPTIONS.workspacePath,
          title: fixture.agentType,
        },
      },
    });
    expect(taskPart).toMatchObject({
      tool: "task",
      state: { metadata: { sessionId: childSessionId } },
    });
    expect(
      events.some(
        (event) =>
          event.type === "session.idle" &&
          event.properties.sessionID === childSessionId,
      ),
    ).toBe(true);
    expect(mergeEffects).toHaveLength(1);
    expect(mergeEffects[0]).toMatchObject({
      mergeFromTaskEvent: {
        durableId: fixture.childRawId,
        workspaceId: OPTIONS.workspaceId,
        parentDurableId: fixture.parentRawId,
        kind: "worker",
        agent: fixture.agentType,
        title: fixture.agentType,
      },
      refreshIndex: true,
    });
  });

  it("emits no todo updates from all fixtures when todo_tool is none", () => {
    const fixtureNames = readdirSync(FIXTURE_DIRECTORY)
      .filter((name) => name.endsWith(".jsonl"))
      .sort();
    const todoEvents = fixtureNames.flatMap((name) =>
      allEvents(replayFixture(name.replace(/\.jsonl$/, ""))).filter(
        (event) => event.type === "todo.updated",
      ),
    );

    expect(fixtureNames).toHaveLength(9);
    expect(todoEvents).toEqual([]);
  });
});
