import { parseChatUrlState } from "@/lib/chat-url-state";
import { describe, expect, it } from "vitest";

describe("chat URL state", () => {
  it("parses valid chat state from browser search params", () => {
    const state = parseChatUrlState(
      new URLSearchParams(
        "workspaceId=ws-2&sessionId=session-2&view=workspace&group=0&age=1d",
      ),
    );

    expect(state).toEqual({
      hasChatState: true,
      workspaceId: "ws-2",
      sessionId: "session-2",
      view: "workspace",
      groupByWorkspace: false,
      age: "1d",
    });
  });

  it("ignores invalid list settings at the URL boundary", () => {
    const state = parseChatUrlState(
      new URLSearchParams("view=grid&group=yes&age=forever"),
    );

    expect(state).toEqual({
      hasChatState: true,
      workspaceId: null,
      sessionId: null,
      view: null,
      groupByWorkspace: null,
      age: null,
    });
  });
});
