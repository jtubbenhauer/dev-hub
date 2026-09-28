import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLiveAdapter } from "@/lib/omo/adapter/live-events";
import {
  buildOmoTextPart,
  buildOmoUserMessage,
} from "@/lib/omo/adapter/shapes";
import { isMessageWithParts } from "@/lib/opencode/message-validation";
import { _resetModuleCaches, useChatStore } from "@/stores/chat-store";
import {
  assistantMessage,
  createAnimationFrameQueue,
  dispatchEvent,
  fixtureRecords,
  resetRekeyStore,
  SESSION_ID,
  userEchoRecords,
  WORKSPACE_ID,
  workspace,
} from "@/tests/stores/chat-store-rekey-fixtures";

let animationFrames = createAnimationFrameQueue();

vi.mock("sonner", () => ({ toast: vi.fn() }));

describe("chat store message.rekeyed", () => {
  beforeEach(() => {
    animationFrames = createAnimationFrameQueue();
    resetRekeyStore();
    vi.stubGlobal("requestAnimationFrame", animationFrames.request);
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "offline" }), { status: 502 }),
      ),
    );
  });

  afterEach(() => {
    animationFrames.flush();
    useChatStore.getState().clearStreamingPoll();
    _resetModuleCaches();
    vi.unstubAllGlobals();
  });

  it("atomically replaces optimistic and provisional fixture messages", async () => {
    await useChatStore
      .getState()
      .sendMessage(
        SESSION_ID,
        "inspect this",
        WORKSPACE_ID,
        undefined,
        undefined,
        undefined,
        [
          {
            mime: "application/pdf",
            dataUrl: "data:application/pdf;base64,JVBERi0=",
            filename: "report.pdf",
          },
        ],
      );
    const adapter = createLiveAdapter({
      sessionId: SESSION_ID,
      workspaceId: "workspace-1",
      workspacePath: "/workspace",
      skillPrefixes: ["frontend"],
    });
    adapter.seed({
      lastKnownModel: "gpt-5.6-sol",
      lastKnownProvider: "openai",
    });
    const records = [
      ...userEchoRecords(),
      ...fixtureRecords("text-turn.jsonl"),
    ];
    for (const record of records) {
      for (const event of adapter.handle(record).events) dispatchEvent(event);
    }

    const countsAfterEachFrame = animationFrames.flush();
    const state = useChatStore.getState().workspaceStates[WORKSPACE_ID];
    const messages = state.messages[SESSION_ID];
    const userMessages = messages.filter(
      (message) => message.info.role === "user",
    );
    const assistantMessages = messages.filter(
      (message) => message.info.role === "assistant",
    );

    expect(countsAfterEachFrame.every((count) => count >= 1)).toBe(true);
    expect(messages).toHaveLength(2);
    expect(messages.every(isMessageWithParts)).toBe(true);
    expect(userMessages).toHaveLength(1);
    expect(userMessages[0]?.info.id).toBe("omo_entry-text-user-1");
    expect(state.optimisticMessageIds[SESSION_ID]).toBeUndefined();
    expect(
      userMessages[0]?.parts.find((part) => part.type === "file"),
    ).toMatchObject({ messageID: "omo_entry-text-user-1" });
    expect(assistantMessages).toMatchObject([
      {
        info: {
          id: "omo_entry-text-assistant-1",
          parentID: "omo_entry-text-user-1",
        },
        parts: [{ type: "text", text: "pong" }],
      },
    ]);
    expect(
      messages.some(
        (message) =>
          message.info.id.startsWith("omo_live_") ||
          message.parts.some(
            (part) =>
              part.id.startsWith("omo_live_") ||
              part.messageID.startsWith("omo_live_"),
          ),
      ),
    ).toBe(false);
  });

  it("collapses loaded provisional and durable copies at the first position", () => {
    const provisional = assistantMessage("omo_live_x", "partial");
    const durable = assistantMessage("omo_assistant-entry", "stale");
    useChatStore.setState({
      workspaceStates: {
        [WORKSPACE_ID]: workspace([provisional, durable]),
      },
    });
    const replacement = assistantMessage("omo_assistant-entry", "final");

    dispatchEvent({
      type: "message.rekeyed",
      properties: {
        sessionID: SESSION_ID,
        fromMessageID: "omo_live_x",
        toMessageID: "omo_assistant-entry",
        info: replacement.info,
        parts: replacement.parts,
      },
    });

    const messages =
      useChatStore.getState().workspaceStates[WORKSPACE_ID].messages[
        SESSION_ID
      ];
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual(replacement);
  });

  it("preserves existing removed-message tombstones", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 204 })),
    );
    const removed = assistantMessage("omo_removed", "removed");
    const replacement = assistantMessage("omo_assistant-entry", "final");
    dispatchEvent({
      type: "message.removed",
      properties: { sessionID: SESSION_ID, messageID: removed.info.id },
    });
    dispatchEvent({
      type: "message.rekeyed",
      properties: {
        sessionID: SESSION_ID,
        fromMessageID: "omo_live_x",
        toMessageID: replacement.info.id,
        info: replacement.info,
        parts: replacement.parts,
      },
    });
    dispatchEvent({
      type: "message.updated",
      properties: { info: removed.info },
    });

    animationFrames.flush();
    const messages =
      useChatStore.getState().workspaceStates[WORKSPACE_ID].messages[
        SESSION_ID
      ];
    expect(messages.map((message) => message.info.id)).toEqual([
      "omo_assistant-entry",
    ]);
  });

  it("supports a same-id user rekey and drops queued stale updates", async () => {
    await useChatStore
      .getState()
      .sendMessage(
        SESSION_ID,
        "with file",
        WORKSPACE_ID,
        undefined,
        undefined,
        undefined,
        [
          {
            mime: "application/pdf",
            dataUrl: "data:application/pdf;base64,JVBERi0=",
            filename: "same.pdf",
          },
        ],
      );
    const info = buildOmoUserMessage({
      id: "omo_user-same",
      sessionID: SESSION_ID,
      created: 3,
      agent: "omo",
      model: { providerID: "openai", modelID: "gpt-5.6-sol" },
    });
    dispatchEvent({ type: "message.updated", properties: { info } });
    dispatchEvent({
      type: "message.part.updated",
      properties: {
        part: buildOmoTextPart({
          id: "omo_user-same_0",
          sessionID: SESSION_ID,
          messageID: "omo_user-same",
          text: "stale",
        }),
      },
    });
    dispatchEvent({
      type: "message.rekeyed",
      properties: {
        sessionID: SESSION_ID,
        fromMessageID: "omo_user-same",
        toMessageID: "omo_user-same",
        info,
        parts: [
          buildOmoTextPart({
            id: "omo_user-same_0",
            sessionID: SESSION_ID,
            messageID: "omo_user-same",
            text: "with file",
          }),
        ],
      },
    });

    animationFrames.flush();
    const state = useChatStore.getState().workspaceStates[WORKSPACE_ID];
    const messages = state.messages[SESSION_ID];
    const filePart = messages[0]?.parts.find((part) => part.type === "file");
    expect(messages).toHaveLength(1);
    expect(messages[0]?.info.id).toBe("omo_user-same");
    expect(messages[0]?.parts[0]).toMatchObject({ text: "with file" });
    expect(filePart).toMatchObject({ messageID: "omo_user-same" });
    expect(state.optimisticMessageIds[SESSION_ID]).toBeUndefined();
    expect(messages.every(isMessageWithParts)).toBe(true);
  });
});
