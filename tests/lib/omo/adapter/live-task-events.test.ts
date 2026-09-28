import { describe, expect, it } from "vitest";
import { createLiveAdapter } from "@/lib/omo/adapter/live-events";
import type { LiveAdapterResult } from "@/lib/omo/adapter/live-events";
import type { JsonlRecord } from "@/lib/omo/jsonl";
import type { Event, ToolPart } from "@/lib/opencode/types";

const OPTIONS = {
  sessionId: "omo_parallel-parent-1",
  workspaceId: "workspace-1",
  workspacePath: "/workspace",
  skillPrefixes: [],
} as const;

function updatedToolParts(results: readonly LiveAdapterResult[]): ToolPart[] {
  const events: Event[] = results.flatMap((result) => result.events);
  return events.flatMap((event) =>
    event.type === "message.part.updated" &&
    event.properties.part.type === "tool"
      ? [event.properties.part]
      : [],
  );
}

function toolPartMetadataSessionId(part: ToolPart): unknown {
  return "metadata" in part.state
    ? part.state.metadata?.["sessionId"]
    : undefined;
}

describe("createLiveTaskEventHandler with two parallel tasks", () => {
  it("matches each task update to its own tool part by task_id, never the other task", () => {
    const adapter = createLiveAdapter(OPTIONS);
    const records: JsonlRecord[] = [
      {
        type: "tool_execution_start",
        toolCallId: "call-a",
        toolName: "task",
        args: { subagent_type: "explore", description: "Task A" },
        timestamp: 1_000,
      },
      {
        type: "tool_execution_start",
        toolCallId: "call-b",
        toolName: "task",
        args: { subagent_type: "debugging", description: "Task B" },
        timestamp: 1_001,
      },
      {
        type: "extension_event",
        name: "omo.task.updated",
        data: {
          parent_session_id: "parallel-parent-1",
          tasks: [
            {
              task_id: "task-a",
              agent_type: "explore",
              status: "running",
              child_session_id: "child-a",
            },
            {
              task_id: "task-b",
              agent_type: "debugging",
              status: "running",
              child_session_id: "child-b",
            },
          ],
        },
        timestamp: 1_010,
      },
      {
        type: "tool_execution_end",
        toolCallId: "call-a",
        toolName: "task",
        result: {
          content: [{ type: "text", text: "done a" }],
          details: { task_id: "task-a", child_session_id: "child-a" },
        },
        isError: false,
        timestamp: 1_020,
      },
      {
        type: "tool_execution_end",
        toolCallId: "call-b",
        toolName: "task",
        result: {
          content: [{ type: "text", text: "done b" }],
          details: { task_id: "task-b", child_session_id: "child-b" },
        },
        isError: false,
        timestamp: 1_021,
      },
      {
        type: "extension_event",
        name: "omo.task.updated",
        data: {
          parent_session_id: "parallel-parent-1",
          tasks: [
            {
              task_id: "task-a",
              agent_type: "explore",
              status: "completed",
              child_session_id: "child-a",
            },
            {
              task_id: "task-b",
              agent_type: "debugging",
              status: "completed",
              child_session_id: "child-b",
            },
          ],
        },
        timestamp: 1_030,
      },
    ];

    const results = records.map((record) => adapter.handle(record));
    const toolParts = updatedToolParts(results);
    const callAPart = toolParts.findLast((part) => part.callID === "call-a");
    const callBPart = toolParts.findLast((part) => part.callID === "call-b");
    if (!callAPart || !callBPart) {
      throw new TypeError("Expected updated tool parts for both tasks");
    }

    expect(toolPartMetadataSessionId(callAPart)).toBe("omo_child-a");
    expect(toolPartMetadataSessionId(callBPart)).toBe("omo_child-b");
  });
});

describe("createLiveTaskEventHandler when omo omits child_session_id", () => {
  it("asks the registry to link the worker by task_id instead", () => {
    const adapter = createLiveAdapter(OPTIONS);

    const result = adapter.handle({
      type: "extension_event",
      name: "omo.task.updated",
      data: {
        parent_session_id: "parallel-parent-1",
        tasks: [
          {
            task_id: "st_task-1",
            status: "running",
            task_summary: "Read math.ts",
            category: "deep-low",
          },
        ],
      },
      timestamp: 2_000,
    });

    expect(result.effects).toEqual([
      {
        linkTaskChild: {
          parentDurableId: "parallel-parent-1",
          taskId: "st_task-1",
          title: "Read math.ts",
          category: "deep-low",
          updatedMs: 2_000,
        },
      },
    ]);
  });
});
