import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { QuestionRequest } from "@opencode-ai/sdk/v2";
import {
  createDialogAdapter,
  type DialogResponseSender,
} from "@/lib/omo/adapter/dialogs";
import { DialogLedger } from "@/lib/omo/dialog-ledger";
import { createJsonlDecoder, type JsonlRecord } from "@/lib/omo/jsonl";
import type { Event } from "@/lib/opencode/types";

export const PUBLIC_ID_PATTERN = /^dh_q_[0-9a-f-]{36}$/;

const ADAPTER_OPTIONS = {
  routingHandle: "rpc-question-1",
  durableId: "durable-question-1",
  workspaceId: "workspace-1",
} as const;

export class FakeDialogHost {
  readonly records: JsonlRecord[] = [];
  readonly send: DialogResponseSender = async (record) => {
    this.records.push(record);
  };
}

export function readQuestionFixture(): JsonlRecord[] {
  const records: JsonlRecord[] = [];
  const decoder = createJsonlDecoder((record) => records.push(record));
  decoder.write(
    readFileSync(
      join(process.cwd(), "tests/fixtures/omo/question.jsonl"),
      "utf8",
    ),
  );
  decoder.end();
  return records;
}

export function fixtureQuestionRequest(): JsonlRecord {
  const record = readQuestionFixture().find(
    (candidate) => candidate.type === "extension_ui_request",
  );
  if (!record) throw new TypeError("Question fixture request is missing");
  return record;
}

export function questionRequests(events: readonly Event[]): QuestionRequest[] {
  return events.flatMap((event) =>
    event.type === "question.asked" ? [event.properties] : [],
  );
}

export function createDialogHarness(now?: () => number) {
  const host = new FakeDialogHost();
  const ledger = new DialogLedger(now ? { now } : undefined);
  const adapter = createDialogAdapter({
    ...ADAPTER_OPTIONS,
    ledger,
    sendResponse: host.send,
  });
  return { adapter, host, ledger };
}
