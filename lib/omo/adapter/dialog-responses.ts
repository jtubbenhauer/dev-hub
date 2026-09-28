import type { QuestionAnswer } from "@opencode-ai/sdk/v2";
import type { DialogLedgerEntry } from "@/lib/omo/dialog-ledger";
import type { JsonlRecord } from "@/lib/omo/jsonl";

function isRecord(value: unknown): value is JsonlRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function resolvedAnswers(
  entry: DialogLedgerEntry,
  value: unknown,
): QuestionAnswer[] {
  const answers = isRecord(value) ? value : {};
  return entry.upstreamQuestionIds.map((id) => {
    const answer = answers[id];
    if (!isRecord(answer)) return [];
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
