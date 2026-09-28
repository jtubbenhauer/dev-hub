import type {
  QuestionAnswer,
  QuestionInfo,
  QuestionRequest,
} from "@opencode-ai/sdk/v2";
import type { DialogLedgerEntry, DialogMethod } from "@/lib/omo/dialog-ledger";
import type { JsonlRecord } from "@/lib/omo/jsonl";

export type MappedDialog = {
  readonly method: DialogMethod;
  readonly upstreamRequestId?: string;
  readonly upstreamQuestionIds: readonly string[];
  readonly request: Omit<QuestionRequest, "id">;
};

export function isDialogRecord(value: unknown): value is JsonlRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function dialogMethod(value: unknown): DialogMethod | undefined {
  switch (value) {
    case "question":
    case "select":
    case "confirm":
    case "input":
    case "editor":
      return value;
    default:
      return undefined;
  }
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function nativeQuestions(value: unknown): {
  readonly questions: QuestionInfo[];
  readonly ids: string[];
} {
  if (!Array.isArray(value)) return { questions: [], ids: [] };
  const questions: QuestionInfo[] = [];
  const ids: string[] = [];
  for (const candidate of value) {
    if (!isDialogRecord(candidate) || typeof candidate.id !== "string") {
      continue;
    }
    const options = Array.isArray(candidate.options)
      ? candidate.options.flatMap((option) =>
          isDialogRecord(option) && typeof option.label === "string"
            ? [
                {
                  label: option.label,
                  description: text(option.description),
                },
              ]
            : [],
        )
      : [];
    ids.push(candidate.id);
    questions.push({
      header: text(candidate.header),
      question: text(candidate.question),
      options,
      multiple: candidate.multiSelect === true,
      custom: true,
    });
  }
  return { questions, ids };
}

function genericQuestion(
  record: JsonlRecord,
  method: DialogMethod,
): QuestionInfo {
  const title = text(record.title, "Question");
  switch (method) {
    case "select":
      return {
        header: title,
        question: title,
        options: Array.isArray(record.options)
          ? record.options.flatMap((option) =>
              typeof option === "string"
                ? [{ label: option, description: "" }]
                : [],
            )
          : [],
        multiple: false,
        custom: false,
      };
    case "confirm":
      return {
        header: title,
        question: text(record.message, title),
        options: [
          { label: "Yes", description: "" },
          { label: "No", description: "" },
        ],
        multiple: false,
        custom: false,
      };
    case "input":
      return {
        header: title,
        question: text(record.placeholder, title),
        options: [],
        multiple: false,
        custom: true,
      };
    case "editor":
      return {
        header: title,
        question: text(record.prefill, title),
        options: [],
        multiple: false,
        custom: true,
      };
    case "question":
      return { header: title, question: title, options: [], custom: true };
  }
}

export function mapDialog(
  record: JsonlRecord,
  sessionID: string,
  currentAssistantMessageID: string | undefined,
): MappedDialog | undefined {
  const method = dialogMethod(record.method);
  if (!method || typeof record.id !== "string") return undefined;
  const native = nativeQuestions(record.questions);
  const questions =
    method === "question"
      ? native.questions
      : [genericQuestion(record, method)];
  if (questions.length === 0) return undefined;
  const toolCallId = text(record.toolCallId);
  const request = {
    sessionID,
    questions,
    ...(toolCallId && currentAssistantMessageID
      ? { tool: { messageID: currentAssistantMessageID, callID: toolCallId } }
      : {}),
  } satisfies Omit<QuestionRequest, "id">;
  return {
    method,
    ...(typeof record.requestId === "string"
      ? { upstreamRequestId: record.requestId }
      : {}),
    upstreamQuestionIds: native.ids,
    request,
  };
}

export function resolvedAnswers(
  entry: DialogLedgerEntry,
  value: unknown,
): QuestionAnswer[] {
  const answers = isDialogRecord(value) ? value : {};
  return entry.upstreamQuestionIds.map((id) => {
    const answer = answers[id];
    if (!isDialogRecord(answer)) return [];
    const selected = Array.isArray(answer.selected)
      ? answer.selected.filter(
          (candidate): candidate is string => typeof candidate === "string",
        )
      : [];
    return typeof answer.text === "string"
      ? [...selected, answer.text]
      : selected;
  });
}

export function responseForAnswers(
  entry: DialogLedgerEntry,
  answers: readonly (readonly string[])[],
): JsonlRecord {
  const base = {
    type: "extension_ui_response",
    id: entry.extUiId,
    sessionId: entry.routingHandle,
  } as const;
  switch (entry.method) {
    case "question": {
      const mappedAnswers: Record<string, JsonlRecord> = {};
      entry.upstreamQuestionIds.forEach((id, index) => {
        const values = answers[index] ?? [];
        const labels = new Set(
          (entry.payload.questions[index]?.options ?? []).map(
            (option) => option.label,
          ),
        );
        const selected = values.filter((value) => labels.has(value));
        const custom = values.filter((value) => !labels.has(value));
        mappedAnswers[id] = {
          selected,
          ...(custom.length > 0 ? { text: custom.join("\n") } : {}),
        };
      });
      return { ...base, answers: mappedAnswers, comment: "" };
    }
    case "select":
      return { ...base, value: answers[0]?.[0] };
    case "confirm":
      return { ...base, confirmed: answers[0]?.[0] === "Yes" };
    case "input":
    case "editor":
      return { ...base, value: answers[0]?.[0] };
  }
}
