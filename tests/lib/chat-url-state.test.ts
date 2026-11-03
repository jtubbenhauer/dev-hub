import { parseChatUrlState } from "@/lib/chat-url-state";
import { describe, expect, it } from "vitest";

describe("chat URL state", () => {
  it("reads the workspace and session of a chat link and ignores its list settings", () => {
    const state = parseChatUrlState(
      new URLSearchParams(
        "workspaceId=ws-2&sessionId=session-2&view=workspace&group=0&age=1d",
      ),
    );

    expect(state).toEqual({ workspaceId: "ws-2", sessionId: "session-2" });
  });

  it("treats empty ids as absent", () => {
    const state = parseChatUrlState(
      new URLSearchParams("workspaceId=&sessionId="),
    );

    expect(state).toEqual({ workspaceId: null, sessionId: null });
  });
});
