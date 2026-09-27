import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  AgentMessageLike,
  SessionEntry,
} from "@/lib/omo/sessions-on-disk";

const FIXTURE_DIRECTORY = join(process.cwd(), "tests/fixtures/omo");

export const OPTIONS = {
  sessionId: "omo_fixture-session",
  workspacePath: "/workspace",
  skillPrefixes: ["frontend", "debugging"],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function fixtureNames(): string[] {
  return readdirSync(FIXTURE_DIRECTORY)
    .filter((name) => name.endsWith(".jsonl"))
    .sort();
}

export function fixtureEntries(fileName: string): SessionEntry[] {
  const lines = readFileSync(join(FIXTURE_DIRECTORY, fileName), "utf8")
    .trim()
    .split("\n");
  const entries: SessionEntry[] = [];
  for (const line of lines) {
    const record: unknown = JSON.parse(line);
    if (!isRecord(record) || typeof record.timestamp !== "string") continue;
    const timestamp = Date.parse(record.timestamp);
    if (
      record.type === "prompt" &&
      typeof record.id === "string" &&
      typeof record.message === "string"
    ) {
      entries.push({
        type: "message",
        id: `entry-${record.id}`,
        parentId: null,
        timestamp,
        message: { role: "user", content: record.message, timestamp },
      });
    }
    if (record.type === "entry_appended" && isRecord(record.entry)) {
      const entry = record.entry;
      if (
        typeof entry.id === "string" &&
        (typeof entry.parentId === "string" || entry.parentId === null) &&
        isRecord(entry.message) &&
        typeof entry.message.role === "string" &&
        "content" in entry.message
      ) {
        entries.push({
          type: "message",
          id: entry.id,
          parentId: entry.parentId,
          timestamp,
          message: entry.message as unknown as AgentMessageLike,
        });
      }
    }
    if (record.type === "compaction_end" && isRecord(record.result)) {
      const result = record.result;
      if (
        typeof result.summary === "string" &&
        typeof result.firstKeptEntryId === "string" &&
        typeof result.tokensBefore === "number"
      ) {
        entries.push({
          type: "compaction",
          id: "fixture-compaction",
          parentId: null,
          timestamp,
          summary: result.summary,
          firstKeptEntryId: result.firstKeptEntryId,
          tokensBefore: result.tokensBefore,
          usage: result.usage,
          details: result.details,
        });
      }
    }
  }
  return entries;
}

export function messageEntry({
  id,
  parentId,
  timestamp,
  message,
}: {
  readonly id: string;
  readonly parentId: string | null;
  readonly timestamp: number;
  readonly message: AgentMessageLike;
}): SessionEntry {
  return { type: "message", id, parentId, timestamp, message };
}

export function scenarioEntries(): SessionEntry[] {
  const userMessage = {
    role: "user",
    content: [
      { type: "text", text: "$frontend inspect this" },
      { type: "image", data: "aGVsbG8=", mimeType: "image/png" },
    ],
    timestamp: 1_000,
  };
  const assistantMessage = {
    role: "assistant",
    content: [
      { type: "thinking", thinking: "reason", startedAt: 1_010 },
      { type: "text", text: "working" },
      { type: "toolCall", id: "call-1", name: "task", arguments: { x: 1 } },
    ],
    provider: "openai",
    model: "gpt-5.6-sol",
    usage: {
      input: 3,
      output: 4,
      cacheRead: 1,
      cacheWrite: 2,
      cost: { total: 0.5 },
    },
    stopReason: "toolUse",
    timestamp: 1_010,
  };
  const toolResultMessage = {
    role: "toolResult",
    toolCallId: "call-1",
    toolName: "task",
    content: [
      { type: "text", text: "done" },
      { type: "image", data: "aW1hZ2U=", mimeType: "image/jpeg" },
    ],
    details: { child_session_id: "child-1" },
    isError: false,
    timestamp: 1_020,
  };
  const bashMessage = {
    role: "bashExecution",
    content: [],
    command: "pwd",
    output: "/workspace",
    timestamp: 1_070,
  };
  return [
    {
      type: "model_change",
      id: "model",
      parentId: null,
      timestamp: 900,
      provider: "openai",
      modelId: "gpt-5.6-sol",
    },
    messageEntry({
      id: "user-1",
      parentId: "model",
      timestamp: 1_000,
      message: userMessage,
    }),
    messageEntry({
      id: "assistant-1",
      parentId: "user-1",
      timestamp: 1_010,
      message: assistantMessage,
    }),
    messageEntry({
      id: "result-1",
      parentId: "assistant-1",
      timestamp: 1_020,
      message: toolResultMessage,
    }),
    {
      type: "compaction",
      id: "compact",
      parentId: "result-1",
      timestamp: 1_030,
      summary: "summary",
      firstKeptEntryId: "user-1",
      tokensBefore: 10,
    },
    {
      type: "branch_summary",
      id: "branch",
      parentId: "compact",
      timestamp: 1_040,
      fromId: "assistant-1",
      summary: "branch summary",
    },
    {
      type: "custom",
      id: "custom",
      parentId: "branch",
      timestamp: 1_050,
      customType: "state",
      data: { count: 1 },
    },
    {
      type: "custom_message",
      id: "custom-message",
      parentId: "custom",
      timestamp: 1_060,
      customType: "notice",
      content: "custom text",
      display: true,
    },
    messageEntry({
      id: "bash",
      parentId: "custom-message",
      timestamp: 1_070,
      message: bashMessage,
    }),
    {
      type: "thinking_level_change",
      id: "thinking",
      parentId: "bash",
      timestamp: 1_080,
      thinkingLevel: "high",
    },
    {
      type: "label",
      id: "label",
      parentId: "thinking",
      timestamp: 1_090,
      targetId: "user-1",
      label: "checkpoint",
    },
    {
      type: "session_info",
      id: "info",
      parentId: "label",
      timestamp: 1_100,
      name: "name",
    },
  ];
}
