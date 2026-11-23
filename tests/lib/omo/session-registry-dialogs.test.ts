// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import type { JsonlRecord } from "@/lib/omo/jsonl";
import type { OmoRegistryEvent } from "@/lib/omo/session-registry";
import type { FakeOmoFixture } from "@/tests/helpers/omo-fake-host";
import {
  createRegistryFixture,
  entriesFixture,
  openFixture,
  type RegistryFixture,
} from "@/tests/lib/omo/session-registry-fixture";

const PENDING_QUESTION: JsonlRecord = {
  type: "extension_ui_request",
  id: "uuid-pending-question",
  method: "question",
  requestId: "request-pending-question",
  waitForAnswer: false,
  questions: [
    {
      id: "q1",
      header: "gcloud login",
      question: "Run gcloud auth login and tell me when it's done?",
      options: [{ label: "Done, logged in", description: "" }],
      multiSelect: false,
    },
  ],
};

function openWithPendingQuestion(
  events: readonly JsonlRecord[] = [],
): FakeOmoFixture {
  return {
    type: "open_session",
    response: {
      data: {
        sessionId: "route-pending",
        state: {
          sessionId: "pending-session",
          sessionFile: "/sessions/pending.jsonl",
          sessionName: "pending-session",
          status: "idle",
          isStreaming: false,
          pendingQuestions: [PENDING_QUESTION],
        },
      },
    },
    events,
  };
}

describe("OmoSessionRegistry live dialogs", () => {
  let fixture: RegistryFixture | undefined;

  afterEach(async () => {
    await fixture?.close();
    fixture = undefined;
  });

  it("emits question.asked for a mid-turn extension_ui_request on an already attached session", async () => {
    // Given an already-live binding
    fixture = await createRegistryFixture([
      openFixture({
        durableId: "dialog-session",
        routingHandle: "route-dialog",
        sessionPath: "/sessions/dialog.jsonl",
      }),
      entriesFixture([], null),
    ]);
    await fixture.runtime.registry.attach({
      workspace: fixture.workspace,
      durableId: "dialog-session",
      sessionPath: "/sessions/dialog.jsonl",
    });
    const events: OmoRegistryEvent[] = [];
    fixture.runtime.registry.subscribe(fixture.workspace.id, (event) =>
      events.push(event),
    );

    // When a mid-turn dialog request arrives on the workspace sink
    fixture.host.emit({
      type: "extension_ui_request",
      sessionId: "route-dialog",
      id: "uuid-mid-turn-1",
      method: "select",
      title: "Allow dangerous command?",
      options: ["Allow", "Block"],
    });

    // Then the live workspace sink receives question.asked, not just the ledger
    await vi.waitFor(() => {
      expect(events.some((event) => event.type === "question.asked")).toBe(
        true,
      );
    });
    const asked = events.find((event) => event.type === "question.asked");
    expect(asked).toMatchObject({
      type: "question.asked",
      properties: {
        sessionID: "omo_dialog-session",
        questions: [
          {
            header: "Allow dangerous command?",
            options: [
              { label: "Allow", description: "" },
              { label: "Block", description: "" },
            ],
          },
        ],
      },
    });
  });

  it("ignores fire-and-forget extension_ui_request methods like notify", async () => {
    // Given an already-live binding
    fixture = await createRegistryFixture([
      openFixture({
        durableId: "notify-session",
        routingHandle: "route-notify",
        sessionPath: "/sessions/notify.jsonl",
      }),
      entriesFixture([], null),
    ]);
    await fixture.runtime.registry.attach({
      workspace: fixture.workspace,
      durableId: "notify-session",
      sessionPath: "/sessions/notify.jsonl",
    });
    const events: OmoRegistryEvent[] = [];
    fixture.runtime.registry.subscribe(fixture.workspace.id, (event) =>
      events.push(event),
    );

    // When a fire-and-forget notify request arrives
    fixture.host.emit({
      type: "extension_ui_request",
      sessionId: "route-notify",
      id: "uuid-notify-1",
      method: "notify",
      message: "Command blocked by user",
      notifyType: "warning",
    });
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Then no question.asked is ever emitted for it
    expect(events.some((event) => event.type === "question.asked")).toBe(false);
  });

  it("announces questions that were already open when the session opened", async () => {
    // Given omo still waits on a question when dev-hub opens the session
    fixture = await createRegistryFixture([
      openWithPendingQuestion(),
      entriesFixture([], null),
    ]);
    const events: OmoRegistryEvent[] = [];
    fixture.runtime.registry.subscribe(fixture.workspace.id, (event) =>
      events.push(event),
    );

    // When dev-hub opens it, before any message read
    await fixture.runtime.registry.attach({
      workspace: fixture.workspace,
      durableId: "pending-session",
      sessionPath: "/sessions/pending.jsonl",
    });

    // Then the ledger holds the question and subscribers were told
    const [pending] =
      fixture.runtime.registry.dialogLedger.requestsForWorkspace(
        fixture.workspace.id,
      );
    expect(pending).toMatchObject({
      sessionID: "omo_pending-session",
      questions: [{ header: "gcloud login" }],
    });
    await vi.waitFor(() => {
      expect(events).toContainEqual({
        type: "question.asked",
        properties: pending,
      });
    });
  });

  it("applies a settlement that arrives while the session is opening", async () => {
    // Given omo settles the question right after reporting it open
    fixture = await createRegistryFixture([
      openWithPendingQuestion([
        {
          type: "question_resolved",
          id: "uuid-pending-question",
          outcome: "timed_out",
        },
      ]),
      entriesFixture([], null),
    ]);
    const events: OmoRegistryEvent[] = [];
    fixture.runtime.registry.subscribe(fixture.workspace.id, (event) =>
      events.push(event),
    );

    // When dev-hub opens the session
    await fixture.runtime.registry.attach({
      workspace: fixture.workspace,
      durableId: "pending-session",
      sessionPath: "/sessions/pending.jsonl",
    });

    // Then the question is gone and subscribers were told it closed
    expect(
      fixture.runtime.registry.dialogLedger.requestsForWorkspace(
        fixture.workspace.id,
      ),
    ).toEqual([]);
    await vi.waitFor(() => {
      const asked = events.flatMap((event) =>
        event.type === "question.asked" ? [event.properties.id] : [],
      );
      const closed = events.flatMap((event) =>
        event.type === "question.rejected" ? [event.properties.requestID] : [],
      );
      expect(asked).toHaveLength(1);
      expect(closed).toEqual(asked);
    });
  });
});
