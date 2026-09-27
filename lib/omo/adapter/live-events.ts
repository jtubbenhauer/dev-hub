import type { Message, Part, UserMessage } from "@opencode-ai/sdk";
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
  messageError,
  messageString,
  messageTimestamp,
  messageUsage,
} from "@/lib/omo/adapter/entry-message-fields";
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

export type {
  Effect,
  LiveAdapter,
  LiveAdapterOptions,
  LiveAdapterResult,
  LiveAdapterSeed,
} from "@/lib/omo/adapter/live-adapter-types";

interface ActiveUserMessage {
  readonly role: "user";
  readonly provisionalId: string;
  readonly created: number;
  readonly parts: Map<number, Part>;
  info: UserMessage;
}

type ActiveMessage = ActiveUserMessage | ActiveAssistantMessage;

function messageUpdated(info: Message): Event {
  return { type: "message.updated", properties: { info } };
}

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

  const handleMessageStart = (record: JsonlRecord): LiveAdapterResult => {
    const source = parseAgentMessage(record.message);
    if (!source) return { events: [], effects: [] };
    const role = parseLiveRole(source.role);
    if (!role) return { events: [], effects: [] };
    const provisionalId = `omo_live_${crypto.randomUUID()}`;
    const created = messageTimestamp(
      source,
      recordTimestamp(record.timestamp),
    );

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
    const source = parseAgentMessage(record.message);
    if (!active || !source || source.role !== "assistant") {
      return { events: [], effects: [] };
    }
    const modelID = messageString(source, "model") ?? lastKnownModel;
    const providerID = messageString(source, "provider") ?? lastKnownProvider;
    lastKnownModel = modelID;
    lastKnownProvider = providerID;
    const completed = messageTimestamp(
      source,
      recordTimestamp(record.timestamp, active.created),
    );
    active.info = buildOmoAssistantMessage({
      id: active.provisionalId,
      sessionID: options.sessionId,
      parentMessageID: lastUserMessageID ?? options.sessionId,
      created: active.created,
      completed:
        messageString(source, "stopReason") === "pending"
          ? undefined
          : completed,
      modelID,
      providerID,
      cwd: options.workspacePath,
      usage: messageUsage(source),
      error: messageError(source),
    });
    return { events: [messageUpdated(active.info)], effects: [] };
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
        default:
          return { events: [], effects: [] };
      }
    },
  };
}
