// @vitest-environment node

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createLiveAdapter } from "@/lib/omo/adapter/live-events";
import type { JsonlRecord } from "@/lib/omo/jsonl";
import type { Event } from "@/lib/opencode/types";

const OPTIONS = {
  sessionId: "omo_status-session-1",
  workspaceId: "workspace-1",
  workspacePath: "/workspace",
  skillPrefixes: ["frontend", "debugging"],
} as const;

function isRecord(value: unknown): value is JsonlRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readFixture(name: string): JsonlRecord[] {
  return readFileSync(
    join(process.cwd(), "tests/fixtures/omo", `${name}.jsonl`),
    "utf8",
  )
    .trim()
    .split("\n")
    .map((line) => {
      const parsed: unknown = JSON.parse(line);
      if (!isRecord(parsed))
        throw new TypeError("fixture line is not a record");
      return parsed;
    });
}

function replay(name: string): Event[] {
  const adapter = createLiveAdapter(OPTIONS);
  return readFixture(name).flatMap((record) => adapter.handle(record).events);
}

describe("createLiveAdapter status events", () => {
  it("moves an aborted fixture session from busy to idle and emits session.idle", () => {
    const events = replay("abort").filter(
      (event) =>
        event.type === "session.status" || event.type === "session.idle",
    );

    expect(events).toEqual([
      {
        type: "session.status",
        properties: {
          sessionID: OPTIONS.sessionId,
          status: { type: "busy" },
        },
      },
      {
        type: "session.status",
        properties: {
          sessionID: OPTIONS.sessionId,
          status: { type: "idle" },
        },
      },
      {
        type: "session.idle",
        properties: { sessionID: OPTIONS.sessionId },
      },
    ]);
  });

  it("maps auto_retry_start to a retry status with the next attempt time", () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    try {
      const result = createLiveAdapter(OPTIONS).handle({
        type: "auto_retry_start",
        attempt: 2,
        maxAttempts: 3,
        delayMs: 2_500,
        errorMessage: "provider overloaded",
      });

      expect(result.events).toEqual([
        {
          type: "session.status",
          properties: {
            sessionID: OPTIONS.sessionId,
            status: {
              type: "retry",
              attempt: 2,
              message: "provider overloaded",
              next: 12_500,
            },
          },
        },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("maps a final retry failure to an UnknownError session error", () => {
    const result = createLiveAdapter(OPTIONS).handle({
      type: "auto_retry_end",
      success: false,
      attempt: 3,
      finalError: "provider remained overloaded",
    });

    expect(result.events).toEqual([
      {
        type: "session.error",
        properties: {
          sessionID: OPTIONS.sessionId,
          error: {
            name: "UnknownError",
            data: { message: "provider remained overloaded" },
          },
        },
      },
    ]);
  });

  it("maps the compaction fixture to session.compacted", () => {
    const compacted = replay("compaction").filter(
      (event) => event.type === "session.compacted",
    );

    expect(compacted).toEqual([
      {
        type: "session.compacted",
        properties: { sessionID: OPTIONS.sessionId },
      },
    ]);
  });

  it("does not emit session.compacted when compaction was aborted", () => {
    const result = createLiveAdapter(OPTIONS).handle({
      type: "compaction_end",
      reason: "manual",
      result: null,
      aborted: true,
      willRetry: false,
    });

    expect(result).toEqual({ events: [], effects: [] });
  });

  it("does not emit session.compacted when compaction failed with an error", () => {
    const result = createLiveAdapter(OPTIONS).handle({
      type: "compaction_end",
      reason: "manual",
      result: null,
      aborted: false,
      errorMessage: "API quota exceeded",
    });

    expect(result).toEqual({ events: [], effects: [] });
  });

  it("maps a successful set_session_name response to a complete session", () => {
    const result = createLiveAdapter(OPTIONS).handle({
      type: "response",
      command: "set_session_name",
      success: true,
      name: "Renamed session",
      timestamp: "2026-09-28T10:07:00.000Z",
    });

    expect(result.events).toEqual([
      {
        type: "session.updated",
        properties: {
          info: {
            id: OPTIONS.sessionId,
            projectID: OPTIONS.workspaceId,
            directory: OPTIONS.workspacePath,
            title: "Renamed session",
            version: "omo",
            time: {
              created: Date.parse("2026-09-28T10:07:00.000Z"),
              updated: Date.parse("2026-09-28T10:07:00.000Z"),
            },
          },
        },
      },
    ]);
  });

  it("does not map a bare set_session_name command", () => {
    const result = createLiveAdapter(OPTIONS).handle({
      type: "set_session_name",
      name: "Renamed session",
    });

    expect(result).toEqual({ events: [], effects: [] });
  });

  it("does not map session_replaced in the live adapter", () => {
    const result = createLiveAdapter(OPTIONS).handle({
      type: "session_replaced",
      durableSessionId: "successor-1",
      sessionFile: "/workspace/successor.jsonl",
    });

    expect(result).toEqual({ events: [], effects: [] });
  });

  it("updates model state without emitting a session event", () => {
    const adapter = createLiveAdapter(OPTIONS);
    const changed = adapter.handle({
      type: "model_changed",
      model: { provider: "anthropic", id: "claude-sonnet" },
    });
    const started = adapter.handle({
      type: "message_start",
      message: { role: "assistant", content: [], timestamp: 1_000 },
    });

    expect(changed).toEqual({ events: [], effects: [] });
    expect(started.events).toMatchObject([
      {
        type: "message.updated",
        properties: {
          info: { providerID: "anthropic", modelID: "claude-sonnet" },
        },
      },
    ]);
  });

  it("ignores queue_update without changing model state", () => {
    const adapter = createLiveAdapter(OPTIONS);
    adapter.seed({
      lastKnownModel: "seed-model",
      lastKnownProvider: "seed-provider",
    });
    const queued = adapter.handle({
      type: "queue_update",
      steering: ["Focus on errors"],
      followUp: ["Summarize"],
      model: { provider: "ignored-provider", id: "ignored-model" },
    });
    const started = adapter.handle({
      type: "message_start",
      message: { role: "assistant", content: [], timestamp: 1_000 },
    });

    expect(queued).toEqual({ events: [], effects: [] });
    expect(started.events).toMatchObject([
      {
        type: "message.updated",
        properties: {
          info: { providerID: "seed-provider", modelID: "seed-model" },
        },
      },
    ]);
  });
});
