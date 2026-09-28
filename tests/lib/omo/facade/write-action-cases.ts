import { describe, expect, it } from "vitest";
import type { JsonlRecord } from "@/lib/omo/jsonl";
import {
  createWriteBinding,
  insertWriteIndexRow,
  useWriteFixture,
  writeJson,
} from "@/tests/lib/omo/facade/write-fixture";

function lastCommand(
  fixture: Awaited<ReturnType<typeof useWriteFixture>>,
): JsonlRecord | undefined {
  return fixture.registry.request.mock.calls.at(-1)?.[1];
}

describe("handleOmoWrite action routes", () => {
  it("aborts an interactive session directly", async () => {
    // Given
    const fixture = await useWriteFixture();
    fixture.source.authorized.add("root");

    // When
    const response = await fixture.request("/session/omo_root/abort");

    // Then
    expect(response.status).toBe(204);
    expect(lastCommand(fixture)).toEqual({ type: "abort" });
  });

  it("cancels a worker task through its parent session", async () => {
    // Given
    const fixture = await useWriteFixture();
    insertWriteIndexRow(fixture.sqlite, { durableId: "parent" });
    insertWriteIndexRow(fixture.sqlite, {
      durableId: "worker",
      kind: "worker",
      parentDurableId: "parent",
      context: '{"task_id":"task-7"}',
      contextAuthoritative: 1,
    });
    fixture.registry.attach.mockResolvedValue(createWriteBinding("parent"));

    // When
    await fixture.request("/session/omo_worker/abort");

    // Then
    expect(fixture.registry.attach).toHaveBeenCalledWith({
      workspace: fixture.workspace,
      durableId: "parent",
    });
    expect(lastCommand(fixture)).toEqual({
      type: "extension_request",
      name: "omo.task.cancel",
      data: { task_id: "task-7" },
    });
  });

  it("formats slash command prompts", async () => {
    // Given
    const fixture = await useWriteFixture();
    fixture.source.authorized.add("root");

    // When
    await fixture.request("/session/omo_root/command", {
      body: { command: "review", arguments: "src" },
    });

    // Then
    expect(lastCommand(fixture)).toEqual({
      type: "prompt",
      message: "/review src",
    });
  });

  it("compacts a session", async () => {
    // Given
    const fixture = await useWriteFixture();
    fixture.source.authorized.add("root");

    // When
    await fixture.request("/session/omo_root/summarize", { body: {} });

    // Then
    expect(lastCommand(fixture)).toEqual({ type: "compact" });
  });

  it("forks from a stripped public entry id", async () => {
    // Given
    const fixture = await useWriteFixture();
    fixture.source.authorized.add("root");
    fixture.registry.request.mockResolvedValue({
      data: { text: "original", cancelled: false },
    });

    // When
    const response = await fixture.request("/session/omo_root/fork", {
      body: { messageID: "omo_user-1" },
    });

    // Then
    expect(lastCommand(fixture)).toEqual({
      type: "fork",
      entryId: "user-1",
    });
    expect(await writeJson(response)).toEqual({
      text: "original",
      cancelled: false,
    });
  });

  it("routes question replies through the dialog ledger", async () => {
    // Given
    const fixture = await useWriteFixture();
    fixture.source.authorized.add("dialog");
    const entry = fixture.dialogLedger.register({
      routingHandle: "route-dialog",
      durableId: "dialog",
      workspaceId: fixture.workspace.id,
      extUiId: "question-1",
      method: "question",
      request: {
        sessionID: "omo_dialog",
        questions: [
          {
            header: "Choice",
            question: "Choose",
            options: [{ label: "A", description: "" }],
            custom: true,
          },
        ],
      },
      upstreamQuestionIds: ["choice"],
    });

    // When
    const response = await fixture.request(
      `/question/${entry.publicId}/reply`,
      { body: { answers: [["A"]] } },
    );

    // Then
    expect(response.status).toBe(204);
    expect(lastCommand(fixture)).toMatchObject({
      type: "extension_ui_response",
      id: "question-1",
      answers: { choice: { selected: ["A"] } },
    });
    expect(fixture.dialogLedger.find(entry.publicId)).toBeUndefined();
  });

  it("returns question_not_found for an unknown dialog id", async () => {
    // Given
    const fixture = await useWriteFixture();

    // When
    const response = await fixture.request("/question/dh_q_missing/reject");

    // Then
    expect(response.status).toBe(404);
    expect(await writeJson(response)).toEqual({ error: "question_not_found" });
    expect(fixture.registry.attach).not.toHaveBeenCalled();
  });

  it("routes question rejection through the dialog ledger", async () => {
    // Given
    const fixture = await useWriteFixture();
    fixture.source.authorized.add("dialog");
    const entry = fixture.dialogLedger.register({
      routingHandle: "route-dialog",
      durableId: "dialog",
      workspaceId: fixture.workspace.id,
      extUiId: "question-2",
      method: "confirm",
      request: {
        sessionID: "omo_dialog",
        questions: [
          {
            header: "Confirm",
            question: "Continue?",
            options: [],
          },
        ],
      },
    });

    // When
    const response = await fixture.request(
      `/question/${entry.publicId}/reject`,
    );

    // Then
    expect(response.status).toBe(204);
    expect(lastCommand(fixture)).toMatchObject({
      type: "extension_ui_response",
      id: "question-2",
      sessionId: "route-dialog",
      cancelled: true,
    });
    expect(fixture.dialogLedger.find(entry.publicId)).toBeUndefined();
  });
});
