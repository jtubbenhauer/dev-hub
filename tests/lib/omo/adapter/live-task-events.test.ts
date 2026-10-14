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
          isActive: true,
        },
      },
    ]);
  });
});

describe("live adapter linkTaskChild for a batched parallel task call", () => {
  it("links every child to the running part and keeps them after the call ends", () => {
    const adapter = createLiveAdapter(OPTIONS);
    adapter.handle({
      type: "tool_execution_start",
      toolCallId: "call-batch",
      toolName: "task",
      args: { tasks: [{ description: "first" }, { description: "second" }] },
      timestamp: 1_000,
    });

    const first = adapter.linkTaskChild("st_a", "omo_child-a");
    const second = adapter.linkTaskChild("st_b", "omo_child-b");
    const repeated = adapter.linkTaskChild("st_b", "omo_child-b");
    const ended = adapter.handle({
      type: "tool_execution_end",
      toolCallId: "call-batch",
      toolName: "task",
      result: { content: [{ type: "text", text: "done" }], details: {} },
      isError: false,
      timestamp: 2_000,
    });

    expect(first).toHaveLength(1);
    expect(repeated).toEqual([]);
    const linked = updatedToolParts([{ events: second, effects: [] }])[0];
    const final = updatedToolParts([ended])[0];
    for (const part of [linked, final]) {
      expect(
        part && "metadata" in part.state && part.state.metadata,
      ).toMatchObject({
        sessionId: "omo_child-a",
        sessionIds: ["omo_child-a", "omo_child-b"],
      });
    }
  });
});

describe("live adapter after the assistant entry is persisted", () => {
  it("keeps later task updates and linked children on the durable message id", () => {
    const adapter = createLiveAdapter(OPTIONS);
    adapter.handle({
      type: "message_start",
      message: { role: "assistant", content: [], timestamp: 1_000 },
    });
    adapter.handle({
      type: "tool_execution_start",
      toolCallId: "call-task",
      toolName: "task",
      args: { task_summary: "Explain add" },
      timestamp: 1_100,
    });
    const rekey = adapter.handle({
      type: "entry_appended",
      timestamp: "1970-01-01T00:00:02.000Z",
      entry: {
        id: "assistant-1",
        parentId: null,
        message: {
          role: "assistant",
          content: [
            { type: "toolCall", id: "call-task", name: "task", arguments: {} },
          ],
          timestamp: 2_000,
        },
      },
    });
    const linked = adapter.linkTaskChild("st_x", "omo_child-x");

    const rekeyEvent = rekey.events[0];
    const rekeyedTool =
      rekeyEvent?.type === "message.rekeyed"
        ? rekeyEvent.properties.parts.find((part) => part.type === "tool")
        : undefined;
    expect(rekeyedTool).toMatchObject({
      messageID: "omo_assistant-1",
      state: { status: "running" },
    });
    expect(
      updatedToolParts([{ events: linked, effects: [] }])[0],
    ).toMatchObject({
      messageID: "omo_assistant-1",
      state: { metadata: { sessionId: "omo_child-x" } },
    });
  });

  it("targets the durable message when the tool starts after persistence", () => {
    const adapter = createLiveAdapter(OPTIONS);
    adapter.handle({
      type: "message_start",
      message: { role: "assistant", content: [], timestamp: 1_000 },
    });
    adapter.handle({
      type: "entry_appended",
      timestamp: "1970-01-01T00:00:02.000Z",
      entry: {
        id: "assistant-2",
        parentId: null,
        message: {
          role: "assistant",
          content: [
            { type: "toolCall", id: "call-late", name: "task", arguments: {} },
          ],
          timestamp: 2_000,
        },
      },
    });

    const started = adapter.handle({
      type: "tool_execution_start",
      toolCallId: "call-late",
      toolName: "task",
      args: {},
      timestamp: 2_100,
    });

    expect(updatedToolParts([started])[0]?.messageID).toBe("omo_assistant-2");
  });
});

describe("createLiveTaskEventHandler with an earlier finished task", () => {
  it("links only the running task's child to the running Task card", () => {
    const adapter = createLiveAdapter(OPTIONS);
    adapter.handle({
      type: "tool_execution_start",
      toolCallId: "call-new",
      toolName: "task",
      args: { subagent_type: "explore", description: "New task" },
      timestamp: 1_000,
    });

    const result = adapter.handle({
      type: "extension_event",
      name: "omo.task.updated",
      data: {
        parent_session_id: "parallel-parent-1",
        tasks: [
          {
            task_id: "st_old",
            agent_type: "explore",
            status: "completed",
            child_session_id: "child-old",
          },
          {
            task_id: "st_new",
            agent_type: "explore",
            status: "running",
            child_session_id: "child-new",
          },
        ],
      },
      timestamp: 2_000,
    });

    const linkedSessionIds = updatedToolParts([result]).map((part) =>
      "metadata" in part.state ? part.state.metadata?.["sessionIds"] : [],
    );
    expect(linkedSessionIds).toEqual([["omo_child-new"]]);
  });
});

describe("createLiveTaskEventHandler task status with child_session_id", () => {
  function statusEventsPerUpdate(statuses: readonly string[]): Event[][] {
    const adapter = createLiveAdapter(OPTIONS);
    return statuses.map((status, index) =>
      adapter
        .handle({
          type: "extension_event",
          name: "omo.task.updated",
          data: {
            parent_session_id: "parallel-parent-1",
            tasks: [
              {
                task_id: "st_child",
                agent_type: "explore",
                status,
                child_session_id: "child-1",
              },
            ],
          },
          timestamp: 2_000 + index,
        })
        .events.filter(
          (event) =>
            event.type === "session.status" || event.type === "session.idle",
        ),
    );
  }

  const busy = {
    type: "session.status",
    properties: { sessionID: "omo_child-1", status: { type: "busy" } },
  };
  const idle = {
    type: "session.status",
    properties: { sessionID: "omo_child-1", status: { type: "idle" } },
  };

  it("reports the child busy while its task runs and idle once it completes", () => {
    expect(statusEventsPerUpdate(["running", "running", "completed"])).toEqual([
      [busy],
      [],
      [
        idle,
        { type: "session.idle", properties: { sessionID: "omo_child-1" } },
      ],
    ]);
  });

  it("does not announce a task that had already finished when first reported", () => {
    expect(statusEventsPerUpdate(["completed", "completed"])).toEqual([
      [idle],
      [],
    ]);
  });
});

describe("createLiveTaskEventHandler sub-agent progress", () => {
  const firstProgress = {
    activity: "Run ls · category:quick · turn 1 (2 tools) · running",
    started_at: 1_000,
    current_tool: "bash",
    turns: 1,
    tool_calls: 2,
    output_tokens: 585,
  };
  const laterProgress = {
    ...firstProgress,
    activity: "Run ls · category:quick · turn 2 (2 tools) · running",
    current_tool: undefined,
    last_assistant_line: "src",
    turns: 2,
  };

  function taskUpdate(
    task: Readonly<Record<string, unknown>>,
    timestamp: number,
  ): JsonlRecord {
    return {
      type: "extension_event",
      name: "omo.task.updated",
      data: { parent_session_id: "parent-1", tasks: [task] },
      timestamp,
    };
  }

  it("reports a running child's progress only when it changes", () => {
    // Given
    const adapter = createLiveAdapter(OPTIONS);
    const child = { task_id: "st_child", child_session_id: "child-1" };

    // When
    const activityPerUpdate = [
      { status: "running", live_progress: firstProgress },
      { status: "running", live_progress: firstProgress },
      { status: "running", live_progress: laterProgress },
      { status: "completed", live_progress: laterProgress },
    ].map((task, index) =>
      adapter
        .handle(taskUpdate({ ...child, ...task }, 2_000 + index))
        .events.filter((event) => event.type === "session.activity"),
    );

    // Then
    expect(activityPerUpdate).toEqual([
      [
        {
          type: "session.activity",
          properties: {
            sessionID: "omo_child-1",
            activity: {
              summary: firstProgress.activity,
              currentTool: "bash",
              turns: 1,
              toolCalls: 2,
              updatedAt: 2_000,
            },
          },
        },
      ],
      [],
      [
        {
          type: "session.activity",
          properties: {
            sessionID: "omo_child-1",
            activity: {
              summary: laterProgress.activity,
              lastLine: "src",
              turns: 2,
              toolCalls: 2,
              updatedAt: 2_002,
            },
          },
        },
      ],
      [],
    ]);
  });

  it("hands changed progress to the worker link when omo omits child_session_id", () => {
    // Given
    const adapter = createLiveAdapter(OPTIONS);
    const task = { task_id: "st_quick", category: "quick" };

    // When
    const links = [
      { status: "running", live_progress: firstProgress },
      { status: "running", live_progress: firstProgress },
      { status: "completed", live_progress: firstProgress },
    ].map(
      (update, index) =>
        adapter.handle(taskUpdate({ ...task, ...update }, 3_000 + index))
          .effects[0],
    );

    // Then
    expect(links[0]).toMatchObject({
      linkTaskChild: {
        isActive: true,
        activity: { summary: firstProgress.activity, currentTool: "bash" },
      },
    });
    expect(links[1]).toMatchObject({ linkTaskChild: { isActive: true } });
    expect(links[1]).not.toHaveProperty("linkTaskChild.activity");
    expect(links[2]).toMatchObject({ linkTaskChild: { isActive: false } });
    expect(links[2]).not.toHaveProperty("linkTaskChild.activity");
  });
});

describe("createLiveTaskEventHandler task status", () => {
  it("marks a finished task inactive so its worker shows idle", () => {
    const adapter = createLiveAdapter(OPTIONS);

    const result = adapter.handle({
      type: "extension_event",
      name: "omo.task.updated",
      data: {
        parent_session_id: "parent-1",
        tasks: [{ task_id: "st_done", status: "completed" }],
      },
      timestamp: 3_000,
    });

    expect(result.effects).toMatchObject([
      { linkTaskChild: { taskId: "st_done", isActive: false } },
    ]);
  });
});
