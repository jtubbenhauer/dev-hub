// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import { _resetModuleCaches, useChatStore } from "@/stores/chat-store";
import {
  createDialogHarness,
  fixtureQuestionRequest,
  PUBLIC_ID_PATTERN,
  questionRequests,
} from "@/tests/lib/omo/adapter/dialogs-fixture";
import { registerDialogLifecycleTests } from "@/tests/lib/omo/adapter/dialogs-lifecycle-cases";

beforeEach(() => {
  vi.restoreAllMocks();
  _resetModuleCaches();
  useChatStore.setState({ workspaceStates: {} });
});

describe("Senpi dialog mapping", () => {
  it("emits a flat opaque QuestionRequest consumable by the chat store", () => {
    const { adapter } = createDialogHarness();
    const raw = fixtureQuestionRequest();
    const warning = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    const [request] = questionRequests(adapter.handle(raw));
    if (!request) throw new TypeError("Expected a question request");
    useChatStore
      .getState()
      .handleEvent(
        { type: "question.asked", properties: request },
        "workspace-1",
      );

    expect(request).toMatchObject({
      sessionID: "omo_durable-question-1",
      questions: [
        {
          header: "Choice",
          options: [
            { label: "Option A", description: "First option" },
            { label: "Option B", description: "Second option" },
          ],
          multiple: false,
          custom: true,
        },
      ],
    });
    expect(request.id).toMatch(PUBLIC_ID_PATTERN);
    expect(request.id).not.toBe(raw.id);
    expect(request.id).not.toBe(raw.requestId);
    expect(request).not.toHaveProperty("request");
    expect(request.tool).toBeUndefined();
    expect(warning).not.toHaveBeenCalled();
    expect(
      useChatStore.getState().workspaceStates["workspace-1"]?.questions,
    ).toEqual([request]);
  });

  it("maps native answers and rejects Senpi's raw id", async () => {
    const { adapter, host } = createDialogHarness();
    const raw = fixtureQuestionRequest();
    const [request] = questionRequests(adapter.handle(raw));
    if (!request) throw new TypeError("Expected a question request");

    const rawIdResult = await adapter.reply(String(raw.id), [["Option A"]]);
    const result = await adapter.reply(request.id, [
      ["Option A", "A custom note"],
    ]);

    expect(rawIdResult).toEqual({ status: 404, error: "question_not_found" });
    expect(result).toEqual({ status: 204 });
    expect(host.records).toEqual([
      {
        type: "extension_ui_response",
        id: "question-ui-1",
        sessionId: "rpc-question-1",
        answers: {
          q1: { selected: ["Option A"], text: "A custom note" },
        },
        comment: "",
      },
    ]);
  });

  it("maps every generic dialog reply and rejection to Senpi fields", async () => {
    const { adapter, host } = createDialogHarness();
    const dialogs = [
      { id: "select", method: "select", title: "Choose", options: ["Allow"] },
      { id: "confirm", method: "confirm", title: "Continue?" },
      { id: "input", method: "input", title: "Name" },
      { id: "editor", method: "editor", title: "Draft" },
      { id: "cancel", method: "input", title: "Optional" },
    ] as const;
    const requests = dialogs.map((dialog) => {
      const [request] = questionRequests(
        adapter.handle({ type: "extension_ui_request", ...dialog }),
      );
      if (!request) throw new TypeError("Expected a generic dialog request");
      return request;
    });

    await adapter.reply(requests[0].id, [["Allow"]]);
    await adapter.reply(requests[1].id, [["No"]]);
    await adapter.reply(requests[2].id, [["Ada"]]);
    await adapter.reply(requests[3].id, [["Line one\nLine two"]]);
    await adapter.reject(requests[4].id);

    expect(host.records).toEqual([
      expect.objectContaining({ id: "select", value: "Allow" }),
      expect.objectContaining({ id: "confirm", confirmed: false }),
      expect.objectContaining({ id: "input", value: "Ada" }),
      expect.objectContaining({ id: "editor", value: "Line one\nLine two" }),
      expect.objectContaining({ id: "cancel", cancelled: true }),
    ]);
  });

  it("replays pending questions and unresolved dialogs to new subscribers", () => {
    const { adapter } = createDialogHarness();
    const [pending] = questionRequests(
      adapter.ingestPendingQuestions([fixtureQuestionRequest()]),
    );
    const [select] = questionRequests(
      adapter.handle({
        type: "extension_ui_request",
        id: "select-pending",
        method: "select",
        title: "Still open",
        options: ["One", "Two"],
      }),
    );
    const replayed = questionRequests(adapter.eventsForSubscriber());

    expect(replayed.map((request) => request.id)).toEqual([
      pending?.id,
      select?.id,
    ]);
    expect(
      replayed.every(
        (request) =>
          PUBLIC_ID_PATTERN.test(request.id) &&
          (request.tool === undefined ||
            (typeof request.tool.messageID === "string" &&
              typeof request.tool.callID === "string")),
      ),
    ).toBe(true);
  });
});

registerDialogLifecycleTests();
