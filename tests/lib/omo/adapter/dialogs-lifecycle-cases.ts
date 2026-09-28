import { describe, expect, it } from "vitest";
import { createLiveAdapter } from "@/lib/omo/adapter/live-events";
import {
  createDialogHarness,
  fixtureQuestionRequest,
  PUBLIC_ID_PATTERN,
  questionRequests,
} from "@/tests/lib/omo/adapter/dialogs-fixture";

export function registerDialogLifecycleTests(): void {
  describe("Senpi dialog lifecycle", () => {
    it("tracks provisional and durable tool message ids, then clears on settle", () => {
      const { adapter } = createDialogHarness();
      const live = createLiveAdapter({
        sessionId: "omo_durable-question-1",
        workspaceId: "workspace-1",
        workspacePath: "/workspace",
        skillPrefixes: [],
      });
      const start = {
        type: "message_start",
        message: { role: "assistant", content: [], timestamp: 1_000 },
      } as const;
      adapter.handle(start, live.handle(start).events);
      const tool = {
        type: "message_update",
        assistantMessageEvent: {
          type: "toolcall_start",
          contentIndex: 0,
          id: "call-question-1",
          toolName: "question",
        },
      } as const;
      const toolEvents = live.handle(tool).events;
      adapter.handle(tool, toolEvents);
      const [provisional] = questionRequests(
        adapter.handle(
          fixtureQuestionRequest(),
          live.handle(fixtureQuestionRequest()).events,
        ),
      );
      const appended = {
        type: "entry_appended",
        timestamp: 1_100,
        entry: {
          id: "assistant-1",
          parentId: null,
          message: { role: "assistant", content: [], timestamp: 1_100 },
        },
      } as const;
      adapter.handle(appended, live.handle(appended).events);
      const [durable] = questionRequests(
        adapter.handle({
          ...fixtureQuestionRequest(),
          id: "question-ui-durable",
          requestId: "question-request-durable",
        }),
      );
      adapter.handle({ type: "agent_settled" });
      const [settled] = questionRequests(
        adapter.handle({
          ...fixtureQuestionRequest(),
          id: "question-ui-settled",
          requestId: "question-request-settled",
        }),
      );
      const toolPart = toolEvents.find(
        (event) =>
          event.type === "message.part.updated" &&
          event.properties.part.type === "tool",
      );

      expect(provisional?.tool).toEqual({
        messageID:
          toolPart?.type === "message.part.updated"
            ? toolPart.properties.part.messageID
            : undefined,
        callID: "call-question-1",
      });
      expect(durable?.tool).toEqual({
        messageID: "omo_assistant-1",
        callID: "call-question-1",
      });
      expect(settled?.tool).toBeUndefined();
    });

    it("emits resolution events under the opaque public id", () => {
      const { adapter } = createDialogHarness();
      const [request] = questionRequests(
        adapter.handle(fixtureQuestionRequest()),
      );
      if (!request) throw new TypeError("Expected a question request");

      const events = adapter.handle({
        type: "question_resolved",
        id: "question-ui-1",
        outcome: "answered",
        answers: { q1: { selected: ["Option B"] } },
      });

      expect(events).toEqual([
        {
          type: "question.replied",
          properties: {
            sessionID: "omo_durable-question-1",
            requestID: request.id,
            answers: [["Option B"]],
          },
        },
      ]);
    });

    it("rekeys unresolved dialogs for a successor and preserves routing", async () => {
      const { adapter, host, ledger } = createDialogHarness();
      const [oldRequest] = questionRequests(
        adapter.handle(fixtureQuestionRequest()),
      );
      if (!oldRequest) throw new TypeError("Expected the old question request");

      const [successor] = ledger.rekeyForSuccessor("durable-question-1", "new");
      if (!successor) throw new TypeError("Expected the successor request");
      const oldResult = await adapter.reply(oldRequest.id, [["Option A"]]);
      const newResult = await adapter.reply(successor.id, [["Option B"]]);

      expect(successor.id).toMatch(PUBLIC_ID_PATTERN);
      expect(successor.id).not.toBe(oldRequest.id);
      expect(successor.sessionID).toBe("omo_new");
      expect(oldResult).toEqual({ status: 404, error: "question_not_found" });
      expect(newResult).toEqual({ status: 204 });
      expect(host.records[0]).toMatchObject({
        id: "question-ui-1",
        sessionId: "rpc-question-1",
      });
    });

    it("expires unresolved entries after 24 hours and clears closed sessions", () => {
      let now = 1_000;
      const { adapter } = createDialogHarness(() => now);
      adapter.handle(fixtureQuestionRequest());

      now += 24 * 60 * 60 * 1_000;
      expect(adapter.eventsForSubscriber()).toEqual([]);

      adapter.handle(fixtureQuestionRequest());
      adapter.handle({ type: "session_closed", sessionId: "rpc-question-1" });
      expect(adapter.eventsForSubscriber()).toEqual([]);
    });
  });
}
