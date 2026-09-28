import type { JsonlRecord } from "@/lib/omo/jsonl";
import type { Event } from "@/lib/opencode/types";
import type {
  LiveAdapter,
  LiveAdapterOptions,
  LiveAdapterResult,
} from "@/lib/omo/adapter/live-adapter-types";
import {
  buildOmoAssistantMessage,
  buildOmoUserMessage,
} from "@/lib/omo/adapter/shapes";
import { buildUserContent } from "@/lib/omo/adapter/entry-content";
import {
  messageString,
  messageTimestamp,
} from "@/lib/omo/adapter/entry-message-fields";
import { completeAssistantMessage } from "@/lib/omo/adapter/live-message-completion";
import {
  buildDurableLiveMessage,
  parseAgentMessage,
  parseAppendedLiveMessage,
  parseLiveRole,
  recordTimestamp,
  type LiveMessageRole,
} from "@/lib/omo/adapter/live-message-snapshot";
import {
  handleAssistantMessageUpdate,
  type ActiveAssistantMessage,
} from "@/lib/omo/adapter/live-message-updates";
import {
  type ActiveMessage,
  messageUpdated,
} from "@/lib/omo/adapter/live-message-state";
import { createLiveStatusEventHandlers } from "@/lib/omo/adapter/live-status-events";
import { createLiveToolEventHandlers } from "@/lib/omo/adapter/live-tool-events";

export type {
  Effect,
  LiveAdapter,
  LiveAdapterOptions,
  LiveAdapterResult,
  LiveAdapterSeed,
} from "@/lib/omo/adapter/live-adapter-types";

export function createLiveAdapter(options: LiveAdapterOptions): LiveAdapter {
  const pendingByRole: Record<LiveMessageRole, ActiveMessage[]> = {
    user: [],
    assistant: [],
  };
  const provisionalToDurable = new Map<string, string>();
  const durableToProvisional = new Map<string, string>();
  let lastUserMessageID: string | undefined;
  let lastKnownModel = "";
  let lastKnownProvider = "";

  const activeAssistant = (): ActiveAssistantMessage | undefined => {
    const active = pendingByRole.assistant.at(-1);
    return active?.role === "assistant" ? active : undefined;
  };

  const toolHandlers = createLiveToolEventHandlers(options, activeAssistant);
  const statusHandlers = createLiveStatusEventHandlers(
    options,
    (modelID, providerID) => {
      lastKnownModel = modelID;
      lastKnownProvider = providerID;
    },
  );

  const handleMessageStart = (record: JsonlRecord): LiveAdapterResult => {
    const source = parseAgentMessage(record.message);
    if (!source) return { events: [], effects: [] };
    const role = parseLiveRole(source.role);
    if (!role) return { events: [], effects: [] };
    const provisionalId = `omo_live_${crypto.randomUUID()}`;
    const created = messageTimestamp(source, recordTimestamp(record.timestamp));

    if (role === "user") {
      const content = buildUserContent(source, {
        entryId: provisionalId.slice("omo_".length),
        sessionID: options.sessionId,
        messageID: provisionalId,
        created,
        skillPrefixes: options.skillPrefixes,
      });
      const info = buildOmoUserMessage({
        id: provisionalId,
        sessionID: options.sessionId,
        created,
        agent: content.agent,
        model: {
          providerID: lastKnownProvider,
          modelID: lastKnownModel,
        },
      });
      pendingByRole.user.push({
        role,
        provisionalId,
        created,
        info,
        parts: new Map(content.parts.map((part, index) => [index, part])),
      });
      return {
        events: [
          messageUpdated(info),
          ...content.parts.map(
            (part): Event => ({
              type: "message.part.updated",
              properties: { part },
            }),
          ),
        ],
        effects: [],
      };
    }

    const modelID = messageString(source, "model") ?? lastKnownModel;
    const providerID = messageString(source, "provider") ?? lastKnownProvider;
    lastKnownModel = modelID;
    lastKnownProvider = providerID;
    const info = buildOmoAssistantMessage({
      id: provisionalId,
      sessionID: options.sessionId,
      parentMessageID: lastUserMessageID ?? options.sessionId,
      created,
      modelID,
      providerID,
      cwd: options.workspacePath,
      usage: { input: 0, output: 0 },
    });
    pendingByRole.assistant.push({
      role,
      provisionalId,
      created,
      info,
      parts: new Map(),
    });
    return { events: [messageUpdated(info)], effects: [] };
  };

  const handleMessageEnd = (record: JsonlRecord): LiveAdapterResult => {
    const active = activeAssistant();
    if (!active) return { events: [], effects: [] };
    const info = completeAssistantMessage(record, active, {
      sessionID: options.sessionId,
      workspacePath: options.workspacePath,
      parentMessageID: lastUserMessageID ?? options.sessionId,
      lastKnownModel,
      lastKnownProvider,
    });
    if (!info) return { events: [], effects: [] };
    active.info = info;
    lastKnownModel = info.modelID;
    lastKnownProvider = info.providerID;
    return { events: [messageUpdated(info)], effects: [] };
  };

  const handleEntryAppended = (record: JsonlRecord): LiveAdapterResult => {
    const appended = parseAppendedLiveMessage(record);
    if (!appended) return { events: [], effects: [] };
    const durableId = `omo_${appended.entry.id}`;
    const pending = pendingByRole[appended.role].shift();
    const fromMessageID =
      pending?.provisionalId ??
      durableToProvisional.get(durableId) ??
      durableId;
    provisionalToDurable.set(fromMessageID, durableId);
    durableToProvisional.set(durableId, fromMessageID);
    const durable = buildDurableLiveMessage(appended, {
      sessionId: options.sessionId,
      workspacePath: options.workspacePath,
      skillPrefixes: options.skillPrefixes,
      parentMessageID: lastUserMessageID ?? options.sessionId,
      lastKnownModel,
      lastKnownProvider,
      fallbackAssistant:
        pending?.role === "assistant" ? pending.info : undefined,
    });
    if (durable.info.role === "user") {
      lastUserMessageID = durableId;
    } else {
      lastKnownModel = durable.info.modelID;
      lastKnownProvider = durable.info.providerID;
    }
    return {
      events: [
        {
          type: "message.rekeyed",
          properties: {
            sessionID: options.sessionId,
            fromMessageID,
            toMessageID: durableId,
            info: durable.info,
            parts: durable.parts,
          },
        },
      ],
      effects: [],
    };
  };

  return {
    seed(state): void {
      lastUserMessageID = state.lastUserMessageID;
      lastKnownModel = state.lastKnownModel ?? "";
      lastKnownProvider = state.lastKnownProvider ?? "";
    },
    handle(record): LiveAdapterResult {
      if (record.type === "response" && record.command === "set_session_name") {
        return statusHandlers.handleSetSessionNameResponse(record);
      }
      switch (record.type) {
        case "message_start":
          return handleMessageStart(record);
        case "message_update": {
          const active = activeAssistant();
          return active
            ? {
                events: handleAssistantMessageUpdate(record, active),
                effects: [],
              }
            : { events: [], effects: [] };
        }
        case "message_end":
          return handleMessageEnd(record);
        case "entry_appended":
          return handleEntryAppended(record);
        case "tool_execution_start":
          return toolHandlers.handleStart(record);
        case "tool_execution_update":
          return toolHandlers.handleUpdate(record);
        case "tool_execution_end":
          return toolHandlers.handleEnd(record);
        case "extension_event":
          return toolHandlers.handleExtension(record);
        case "agent_start":
          return statusHandlers.handleAgentStart();
        case "agent_settled":
          return statusHandlers.handleAgentSettled();
        case "auto_retry_start":
          return statusHandlers.handleRetryStart(record);
        case "auto_retry_end":
          return statusHandlers.handleRetryEnd(record);
        case "compaction_end":
          return statusHandlers.handleCompactionEnd();
        case "model_changed":
          return statusHandlers.handleModelChanged(record);
        case "session_replaced":
        case "queue_update":
          return { events: [], effects: [] };
        default:
          return { events: [], effects: [] };
      }
    },
  };
}
