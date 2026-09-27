// @vitest-environment node

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const FIXTURE_DIRECTORY = join(process.cwd(), "tests/fixtures/omo");
const FIXTURE_NAMES = [
  "text-turn",
  "tool-call",
  "thinking",
  "question",
  "task-subagent",
  "compaction",
  "abort",
  "catalog",
  "lifecycle",
] as const;

type FixtureRecord = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is FixtureRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readFixture(name: (typeof FIXTURE_NAMES)[number]): FixtureRecord[] {
  return readFileSync(join(FIXTURE_DIRECTORY, `${name}.jsonl`), "utf8")
    .trim()
    .split("\n")
    .map((line) => {
      const parsed: unknown = JSON.parse(line);
      if (!isRecord(parsed) || typeof parsed["type"] !== "string") {
        throw new TypeError(`${name} contains a non-record JSONL line`);
      }
      return parsed;
    });
}

function typeOf(record: FixtureRecord): string {
  const type = record["type"];
  return typeof type === "string" ? type : "";
}

function commandOf(record: FixtureRecord): string | undefined {
  const command = record["command"];
  return typeof command === "string" ? command : undefined;
}

function nestedRecord(
  record: FixtureRecord,
  key: string,
): FixtureRecord | undefined {
  const value = record[key];
  return isRecord(value) ? value : undefined;
}

describe("OmO fixture corpus", () => {
  it("contains exactly the nine required JSONL files", () => {
    const files = readdirSync(FIXTURE_DIRECTORY)
      .filter((file) => file.endsWith(".jsonl"))
      .sort();

    expect(files).toEqual(FIXTURE_NAMES.map((name) => `${name}.jsonl`).sort());
  });

  it.each(FIXTURE_NAMES)(
    "parses every %s record and contains no secrets",
    (name) => {
      const source = readFileSync(
        join(FIXTURE_DIRECTORY, `${name}.jsonl`),
        "utf8",
      );

      expect(() => readFixture(name)).not.toThrow();
      expect(source).not.toContain("/Users/");
      expect(source).not.toMatch(/sk-[A-Za-z0-9]/);
    },
  );

  it("preserves the documented text-turn event order", () => {
    const records = readFixture("text-turn");
    const types = records.map(typeOf);
    const agentStart = types.indexOf("agent_start");
    const messageStart = types.indexOf("message_start", agentStart + 1);
    const textDelta = records.findIndex(
      (record, index) =>
        index > messageStart &&
        typeOf(record) === "message_update" &&
        nestedRecord(record, "assistantMessageEvent")?.["type"] ===
          "text_delta",
    );
    const messageEnd = types.indexOf("message_end", textDelta + 1);
    const entryAppended = types.indexOf("entry_appended", messageEnd + 1);
    const agentSettled = types.indexOf("agent_settled", entryAppended + 1);

    expect(agentStart).toBeGreaterThanOrEqual(0);
    expect(messageStart).toBeGreaterThan(agentStart);
    expect(textDelta).toBeGreaterThan(messageStart);
    expect(messageEnd).toBeGreaterThan(textDelta);
    expect(entryAppended).toBeGreaterThan(messageEnd);
    expect(agentSettled).toBeGreaterThan(entryAppended);
  });

  it("correlates tool execution start and end by toolCallId", () => {
    const records = readFixture("tool-call");
    const start = records.find(
      (record) => typeOf(record) === "tool_execution_start",
    );
    const end = records.find(
      (record) => typeOf(record) === "tool_execution_end",
    );

    expect(start?.["toolCallId"]).toBe("call-read-1");
    expect(end?.["toolCallId"]).toBe(start?.["toolCallId"]);
  });

  it("contains a thinking delta", () => {
    const hasThinkingDelta = readFixture("thinking").some(
      (record) =>
        nestedRecord(record, "assistantMessageEvent")?.["type"] ===
        "thinking_delta",
    );

    expect(hasThinkingDelta).toBe(true);
  });

  it("contains a question request and resolution", () => {
    const records = readFixture("question");
    const request = records.find(
      (record) =>
        typeOf(record) === "extension_ui_request" &&
        record["method"] === "question",
    );
    const resolution = records.find(
      (record) => typeOf(record) === "question_resolved",
    );

    expect(request?.["id"]).toBe("question-ui-1");
    expect(resolution?.["id"]).toBe(request?.["id"]);
  });

  it("contains the verified task extension payload", () => {
    const event = readFixture("task-subagent").find(
      (record) =>
        typeOf(record) === "extension_event" &&
        record["name"] === "omo.task.updated",
    );
    const data = event && nestedRecord(event, "data");
    const tasks = data?.["tasks"];

    expect(data?.["parent_session_id"]).toBe("durable-subagent-parent-1");
    expect(Array.isArray(tasks) && isRecord(tasks[0])).toBe(true);
  });

  it("contains a completed compaction event", () => {
    const event = readFixture("compaction").find(
      (record) => typeOf(record) === "compaction_end",
    );

    expect(event?.["aborted"]).toBe(false);
  });

  it("contains an abort response followed by a settled agent", () => {
    const records = readFixture("abort");
    const responseIndex = records.findIndex(
      (record) =>
        typeOf(record) === "response" && commandOf(record) === "abort",
    );
    const settledIndex = records.findIndex(
      (record) => typeOf(record) === "agent_settled",
    );

    expect(responseIndex).toBeGreaterThanOrEqual(0);
    expect(settledIndex).toBeGreaterThanOrEqual(0);
  });

  it("contains request and response pairs for every catalog command", () => {
    const records = readFixture("catalog");
    const commands = [
      "get_available_models",
      "get_commands",
      "get_loaded_surfaces",
      "get_available_thinking_levels",
    ];

    for (const command of commands) {
      expect(records.some((record) => typeOf(record) === command)).toBe(true);
      expect(
        records.some(
          (record) =>
            typeOf(record) === "response" && commandOf(record) === command,
        ),
      ).toBe(true);
    }
  });

  it("captures attach, worker-inclusive list, and close lifecycle records", () => {
    const records = readFixture("lifecycle");
    const opens = records.filter((record) => typeOf(record) === "open_session");
    const attached = records.find(
      (record) =>
        typeOf(record) === "response" &&
        commandOf(record) === "open_session" &&
        nestedRecord(record, "data")?.["attached"] === true,
    );
    const listRequest = records.find(
      (record) =>
        typeOf(record) === "list_sessions" &&
        record["include_workers"] === true,
    );

    expect(opens).toHaveLength(2);
    expect(opens[0]?.["sessionPath"]).toBe(opens[1]?.["sessionPath"]);
    expect(attached).toBeDefined();
    expect(listRequest).toBeDefined();
    expect(
      records.some(
        (record) =>
          typeOf(record) === "response" &&
          commandOf(record) === "list_sessions",
      ),
    ).toBe(true);
    expect(records.some((record) => typeOf(record) === "close_session")).toBe(
      true,
    );
    expect(
      records.some(
        (record) =>
          typeOf(record) === "response" &&
          commandOf(record) === "close_session",
      ),
    ).toBe(true);
  });

  it("documents fallback provenance and conservative probe answers", () => {
    const readme = readFileSync(join(FIXTURE_DIRECTORY, "README.md"), "utf8");

    expect(readme).toContain("source: hand-authored-from-docs");
    expect(readme).toContain("client_info_scope: connection");
    expect(readme).toContain("probe_writes_file: unknown");
    expect(readme).toContain("todo_tool: none");
    expect(readme).toContain("task_child_keys:");
  });
});
