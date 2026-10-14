// @vitest-environment node

import { describe, expect, it } from "vitest";
import { createLiveAdapter } from "@/lib/omo/adapter/live-events";
import type { JsonlRecord } from "@/lib/omo/jsonl";
import type { Event, PermissionRequest } from "@/lib/opencode/types";
import { createDialogHarness } from "@/tests/lib/omo/adapter/dialogs-fixture";

const EDIT_PROMPT: JsonlRecord = {
  type: "extension_ui_request",
  id: "ui-edit-1",
  method: "select",
  title:
    "Permission required: edit\n\nFile: /workspace/notes.txt\n\nPatterns:\n  - /workspace/notes.txt",
  options: ["Allow once", "Allow always", "Deny", "Deny with feedback"],
  toolCallId: "call-write-1",
  sessionId: "rpc-question-1",
};

const EVAL_PROMPT: JsonlRecord = {
  type: "extension_ui_request",
  id: "ui-eval-1",
  method: "select",
  title: "Permission required: eval\n\nTool: eval\n\nPatterns:\n  - *",
  options: ["Allow once", "Allow always", "Deny", "Deny with feedback"],
  toolCallId: "call-eval-1",
  parentToolCallId: "call-codemode-1",
  sessionId: "rpc-question-1",
};

function permissionRequests(events: readonly Event[]): PermissionRequest[] {
  return events.flatMap((event) =>
    event.type === "permission.asked" ? [event.properties] : [],
  );
}

function startAssistantMessage(
  adapter: ReturnType<typeof createDialogHarness>["adapter"],
): string {
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
  const events = live.handle(start).events;
  adapter.handle(start, events);
  const messageId = events.flatMap((event) =>
    event.type === "message.updated" ? [event.properties.info.id] : [],
  )[0];
  if (messageId === undefined) throw new TypeError("No assistant message");
  return messageId;
}

describe("omo permission prompts", () => {
  it("maps a permission prompt to a permission request bound to its tool call", () => {
    const { adapter, ledger } = createDialogHarness();
    const messageID = startAssistantMessage(adapter);

    const events = adapter.handle(EDIT_PROMPT);

    const [request] = permissionRequests(events);
    expect(events).toHaveLength(1);
    expect(request).toEqual({
      id: expect.stringMatching(/^dh_p_[0-9a-f-]{36}$/),
      sessionID: "omo_durable-question-1",
      permission: "edit",
      patterns: ["/workspace/notes.txt"],
      always: ["/workspace/notes.txt"],
      metadata: { File: "/workspace/notes.txt", toolCallId: "call-write-1" },
      tool: { messageID, callID: "call-write-1" },
    });
    expect(ledger.permissionsForWorkspace("workspace-1")).toEqual([request]);
    expect(ledger.requestsForWorkspace("workspace-1")).toEqual([]);
  });

  it("keeps a tool-wide pattern and the parent call of a nested tool call", () => {
    const { adapter } = createDialogHarness();

    const [request] = permissionRequests(adapter.handle(EVAL_PROMPT));

    expect(request).toMatchObject({
      permission: "eval",
      patterns: ["*"],
      metadata: {
        Tool: "eval",
        toolCallId: "call-eval-1",
        parentToolCallId: "call-codemode-1",
      },
    });
    expect(request?.tool).toBeUndefined();
  });

  it("registers a repeated prompt only once", () => {
    const { adapter, ledger } = createDialogHarness();

    const [first] = permissionRequests(adapter.handle(EDIT_PROMPT));
    const [second] = permissionRequests(adapter.handle(EDIT_PROMPT));

    expect(second?.id).toBe(first?.id);
    expect(ledger.permissionsForWorkspace("workspace-1")).toHaveLength(1);
  });

  it("keeps an ordinary select dialog as a question", () => {
    const { adapter, ledger } = createDialogHarness();

    const events = adapter.handle({
      type: "extension_ui_request",
      id: "ui-select-1",
      method: "select",
      title: "Pick a branch",
      options: ["main", "dev"],
    });

    expect(events.map((event) => event.type)).toEqual(["question.asked"]);
    expect(ledger.permissionsForWorkspace("workspace-1")).toEqual([]);
  });

  it("clears a prompt that is still open when the turn settles", () => {
    const { adapter, ledger } = createDialogHarness();
    const [request] = permissionRequests(adapter.handle(EDIT_PROMPT));

    const settled = adapter.handle({
      type: "agent_settled",
      sessionId: "rpc-question-1",
    });
    const settledAgain = adapter.handle({
      type: "agent_settled",
      sessionId: "rpc-question-1",
    });

    expect(settled).toEqual([
      {
        type: "permission.replied",
        properties: {
          sessionID: "omo_durable-question-1",
          requestID: request?.id,
          reply: "reject",
        },
      },
    ]);
    expect(settledAgain).toEqual([]);
    expect(ledger.permissionsForWorkspace("workspace-1")).toEqual([]);
  });

  it("clears prompts only when their own session closes", () => {
    const { adapter, ledger } = createDialogHarness();
    adapter.handle(EDIT_PROMPT);

    const otherClosed = adapter.handle({
      type: "session_closed",
      sessionId: "rpc-other",
      reason: "client_close",
    });
    const ownClosed = adapter.handle({
      type: "session_closed",
      sessionId: "rpc-question-1",
      reason: "client_close",
    });

    expect(otherClosed).toEqual([]);
    expect(ownClosed.map((event) => event.type)).toEqual([
      "permission.replied",
    ]);
    expect(ledger.permissionsForWorkspace("workspace-1")).toEqual([]);
  });

  it("replays open prompts to a new subscriber", () => {
    const { adapter } = createDialogHarness();
    const [request] = permissionRequests(adapter.handle(EDIT_PROMPT));

    expect(adapter.eventsForSubscriber()).toEqual([
      { type: "permission.asked", properties: request },
    ]);
  });
});
