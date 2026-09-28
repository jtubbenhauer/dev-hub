import type { SessionStatus } from "@opencode-ai/sdk";
import type {
  LiveAdapterOptions,
  LiveAdapterResult,
} from "@/lib/omo/adapter/live-adapter-types";
import { recordTimestamp } from "@/lib/omo/adapter/live-message-snapshot";
import { buildOmoSession } from "@/lib/omo/adapter/shapes";
import type { JsonlRecord } from "@/lib/omo/jsonl";
import type { Event } from "@/lib/opencode/types";

export interface LiveStatusEventHandlers {
  readonly handleAgentStart: () => LiveAdapterResult;
  readonly handleAgentSettled: () => LiveAdapterResult;
  readonly handleRetryStart: (record: JsonlRecord) => LiveAdapterResult;
  readonly handleRetryEnd: (record: JsonlRecord) => LiveAdapterResult;
  readonly handleCompactionEnd: () => LiveAdapterResult;
  readonly handleModelChanged: (record: JsonlRecord) => LiveAdapterResult;
  readonly handleSetSessionNameResponse: (
    record: JsonlRecord,
  ) => LiveAdapterResult;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function emptyResult(): LiveAdapterResult {
  return { events: [], effects: [] };
}

function resultWithEvents(events: Event[]): LiveAdapterResult {
  return { events, effects: [] };
}

function statusEvent(sessionID: string, status: SessionStatus): Event {
  return {
    type: "session.status",
    properties: { sessionID, status },
  };
}

function responseTitle(record: JsonlRecord): string | undefined {
  if (typeof record.name === "string") return record.name;
  if (!isRecord(record.data)) return undefined;
  return typeof record.data.name === "string" ? record.data.name : undefined;
}

function rawSessionId(sessionId: string): string {
  return sessionId.startsWith("omo_")
    ? sessionId.slice("omo_".length)
    : sessionId;
}

export function createLiveStatusEventHandlers(
  options: LiveAdapterOptions,
  updateModel: (modelID: string, providerID: string) => void,
): LiveStatusEventHandlers {
  const handleAgentStart = (): LiveAdapterResult =>
    resultWithEvents([statusEvent(options.sessionId, { type: "busy" })]);

  const handleAgentSettled = (): LiveAdapterResult =>
    resultWithEvents([
      statusEvent(options.sessionId, { type: "idle" }),
      {
        type: "session.idle",
        properties: { sessionID: options.sessionId },
      },
    ]);

  const handleRetryStart = (record: JsonlRecord): LiveAdapterResult => {
    if (
      typeof record.attempt !== "number" ||
      !Number.isFinite(record.attempt) ||
      typeof record.maxAttempts !== "number" ||
      !Number.isFinite(record.maxAttempts) ||
      typeof record.delayMs !== "number" ||
      !Number.isFinite(record.delayMs) ||
      typeof record.errorMessage !== "string"
    ) {
      return emptyResult();
    }
    return resultWithEvents([
      statusEvent(options.sessionId, {
        type: "retry",
        attempt: record.attempt,
        message: record.errorMessage,
        next: Date.now() + record.delayMs,
      }),
    ]);
  };

  const handleRetryEnd = (record: JsonlRecord): LiveAdapterResult => {
    if (record.success !== false || typeof record.finalError !== "string") {
      return emptyResult();
    }
    return resultWithEvents([
      {
        type: "session.error",
        properties: {
          sessionID: options.sessionId,
          error: {
            name: "UnknownError",
            data: { message: record.finalError },
          },
        },
      },
    ]);
  };

  const handleCompactionEnd = (): LiveAdapterResult =>
    resultWithEvents([
      {
        type: "session.compacted",
        properties: { sessionID: options.sessionId },
      },
    ]);

  const handleModelChanged = (record: JsonlRecord): LiveAdapterResult => {
    if (!isRecord(record.model)) return emptyResult();
    const modelID = record.model.id;
    const providerID = record.model.provider;
    if (typeof modelID === "string" && typeof providerID === "string") {
      updateModel(modelID, providerID);
    }
    return emptyResult();
  };

  const handleSetSessionNameResponse = (
    record: JsonlRecord,
  ): LiveAdapterResult => {
    if (record.success !== true) return emptyResult();
    const title = responseTitle(record);
    if (title === undefined) return emptyResult();
    const updated = recordTimestamp(record.timestamp, Date.now());
    const info = buildOmoSession({
      rawId: rawSessionId(options.sessionId),
      workspaceId: options.workspaceId,
      directory: options.workspacePath,
      title,
      created: updated,
      updated,
    });
    return resultWithEvents([
      { type: "session.updated", properties: { info } },
    ]);
  };

  return {
    handleAgentStart,
    handleAgentSettled,
    handleRetryStart,
    handleRetryEnd,
    handleCompactionEnd,
    handleModelChanged,
    handleSetSessionNameResponse,
  };
}
