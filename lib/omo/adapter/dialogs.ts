import type { QuestionRequest } from "@opencode-ai/sdk/v2";
import { mapDialog } from "@/lib/omo/adapter/dialog-mapping";
import {
  resolvedAnswers,
  responseForAnswers,
} from "@/lib/omo/adapter/dialog-responses";
import { DialogLedger } from "@/lib/omo/dialog-ledger";
import type { JsonlRecord } from "@/lib/omo/jsonl";
import type { Event } from "@/lib/opencode/types";

export type DialogResponseSender = (record: JsonlRecord) => Promise<void>;

export type DialogActionResult =
  | { readonly status: 204 }
  | { readonly status: 404; readonly error: "question_not_found" };

export type DialogAdapterOptions = {
  readonly ledger: DialogLedger;
  readonly routingHandle: string;
  readonly durableId: string;
  readonly workspaceId: string;
  readonly sendResponse: DialogResponseSender;
};

export interface DialogAdapter {
  readonly handle: (
    record: JsonlRecord,
    liveEvents?: readonly Event[],
  ) => Event[];
  readonly ingestPendingQuestions: (value: unknown) => Event[];
  readonly eventsForSubscriber: () => Event[];
  readonly reply: (
    publicId: string,
    answers: readonly (readonly string[])[],
  ) => Promise<DialogActionResult>;
  readonly reject: (publicId: string) => Promise<DialogActionResult>;
}

function isRecord(value: unknown): value is JsonlRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function askedEvent(request: QuestionRequest): Event {
  return { type: "question.asked", properties: request };
}

export function createDialogAdapter(
  options: DialogAdapterOptions,
): DialogAdapter {
  let currentAssistantMessageID: string | undefined;

  const register = (record: JsonlRecord): Event[] => {
    const mapped = mapDialog(
      record,
      `omo_${options.durableId}`,
      currentAssistantMessageID,
    );
    if (!mapped || typeof record.id !== "string") return [];
    const entry = options.ledger.register({
      routingHandle: options.routingHandle,
      durableId: options.durableId,
      workspaceId: options.workspaceId,
      extUiId: record.id,
      ...(mapped.upstreamRequestId === undefined
        ? {}
        : { upstreamRequestId: mapped.upstreamRequestId }),
      method: mapped.method,
      request: mapped.request,
      upstreamQuestionIds: mapped.upstreamQuestionIds,
    });
    return [askedEvent(entry.payload)];
  };

  const send = async (
    publicId: string,
    answers: readonly (readonly string[])[],
    isCancelled: boolean,
  ): Promise<DialogActionResult> => {
    const entry = options.ledger.find(publicId);
    if (!entry) return { status: 404, error: "question_not_found" };
    await options.sendResponse(
      isCancelled
        ? {
            type: "extension_ui_response",
            id: entry.extUiId,
            sessionId: entry.routingHandle,
            cancelled: true,
          }
        : responseForAnswers(entry, answers),
    );
    options.ledger.resolve(publicId);
    return { status: 204 };
  };

  return {
    handle(record, liveEvents = []): Event[] {
      for (const event of liveEvents) {
        if (
          event.type === "message.updated" &&
          event.properties.info.role === "assistant"
        ) {
          currentAssistantMessageID = event.properties.info.id;
        }
        if (
          event.type === "message.rekeyed" &&
          event.properties.info.role === "assistant"
        ) {
          currentAssistantMessageID = event.properties.toMessageID;
        }
      }
      if (record.type === "agent_settled") {
        currentAssistantMessageID = undefined;
        return [];
      }
      if (record.type === "session_closed") {
        if (record.sessionId === options.routingHandle) {
          options.ledger.removeByRoutingHandle(options.routingHandle);
        }
        return [];
      }
      if (record.type === "extension_ui_request") return register(record);
      if (
        record.type !== "question_resolved" ||
        typeof record.id !== "string"
      ) {
        return [];
      }
      const entry = options.ledger.resolveUpstream(
        options.routingHandle,
        record.id,
      );
      if (!entry) return [];
      if (
        record.outcome === "answered" ||
        record.outcome === "comment_submitted"
      ) {
        return [
          {
            type: "question.replied",
            properties: {
              sessionID: entry.payload.sessionID,
              requestID: entry.publicId,
              answers: resolvedAnswers(entry, record.answers),
            },
          },
        ];
      }
      return [
        {
          type: "question.rejected",
          properties: {
            sessionID: entry.payload.sessionID,
            requestID: entry.publicId,
          },
        },
      ];
    },
    ingestPendingQuestions(value): Event[] {
      if (!Array.isArray(value)) return [];
      return value.flatMap((record) =>
        isRecord(record) ? register(record) : [],
      );
    },
    eventsForSubscriber(): Event[] {
      return options.ledger
        .requestsForWorkspace(options.workspaceId)
        .map(askedEvent);
    },
    reply(publicId, answers): Promise<DialogActionResult> {
      return send(publicId, answers, false);
    },
    reject(publicId): Promise<DialogActionResult> {
      return send(publicId, [], true);
    },
  };
}
