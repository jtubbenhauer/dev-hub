import { describe, expect, it } from "vitest";
import {
  advanceChatListWindow,
  CHAT_LIST_START_INDEX,
} from "@/lib/chat/chat-list-window";

function messagesWithIds(...ids: string[]) {
  return ids.map((id) => ({ info: { id } }));
}

describe("advanceChatListWindow", () => {
  it("starts a session at the fixed start index", () => {
    const window = advanceChatListWindow(
      null,
      "ses-a",
      messagesWithIds("m3", "m4"),
    );

    expect(window).toEqual({
      sessionId: "ses-a",
      firstMessageId: "m3",
      firstItemIndex: CHAT_LIST_START_INDEX,
    });
  });

  it("drops the first item index by the number of prepended messages", () => {
    const initial = advanceChatListWindow(
      null,
      "ses-a",
      messagesWithIds("m3", "m4"),
    );

    const afterPrepend = advanceChatListWindow(
      initial,
      "ses-a",
      messagesWithIds("m1", "m2", "m3", "m4"),
    );

    expect(afterPrepend.firstItemIndex).toBe(CHAT_LIST_START_INDEX - 2);
    expect(afterPrepend.firstMessageId).toBe("m1");
  });

  it("returns the same window when only newer messages were appended", () => {
    const initial = advanceChatListWindow(
      null,
      "ses-a",
      messagesWithIds("m3", "m4"),
    );

    expect(
      advanceChatListWindow(
        initial,
        "ses-a",
        messagesWithIds("m3", "m4", "m5"),
      ),
    ).toBe(initial);
  });

  it("keeps the index when the head message is removed instead of prepended", () => {
    const initial = advanceChatListWindow(
      null,
      "ses-a",
      messagesWithIds("m3", "m4"),
    );

    const afterCompaction = advanceChatListWindow(
      initial,
      "ses-a",
      messagesWithIds("summary", "m4"),
    );

    expect(afterCompaction.firstItemIndex).toBe(CHAT_LIST_START_INDEX);
    expect(afterCompaction.firstMessageId).toBe("summary");
  });

  it("resets to the start index when the chat switches session", () => {
    const prepended = advanceChatListWindow(
      advanceChatListWindow(null, "ses-a", messagesWithIds("m3")),
      "ses-a",
      messagesWithIds("m1", "m2", "m3"),
    );

    const otherSession = advanceChatListWindow(
      prepended,
      "ses-b",
      messagesWithIds("x1"),
    );

    expect(otherSession.firstItemIndex).toBe(CHAT_LIST_START_INDEX);
    expect(otherSession.sessionId).toBe("ses-b");
  });
});
