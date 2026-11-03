import { describe, expect, it } from "vitest";

import {
  createChatSessionTitleLookups,
  workbenchTabTitle,
} from "@/components/workbench/workbench-tab-title";

const WORKSPACE_ID = "ws-1";

const chatTitleLookups = createChatSessionTitleLookups({
  [WORKSPACE_ID]: {
    sessions: {
      "s-titled": { title: "Fix the flaky test" },
      "s-untitled": { title: "" },
    },
  },
});

describe("workbenchTabTitle", () => {
  it("uses the chat-store session title for a chat tab", () => {
    // When
    const title = workbenchTabTitle(
      { kind: "chat", workspaceId: WORKSPACE_ID, sessionId: "s-titled" },
      chatTitleLookups,
    );

    // Then
    expect(title).toBe("Fix the flaky test");
  });

  it.each([
    ["has no session yet", null],
    ["is unknown to the chat store", "s-missing"],
    ["has an empty title", "s-untitled"],
  ])("falls back to New chat when the chat %s", (_label, sessionId) => {
    // When
    const title = workbenchTabTitle(
      { kind: "chat", workspaceId: WORKSPACE_ID, sessionId },
      chatTitleLookups,
    );

    // Then
    expect(title).toBe("New chat");
  });

  it("falls back to New chat when the workspace is unknown to the chat store", () => {
    // When
    const title = workbenchTabTitle(
      { kind: "chat", workspaceId: "ws-unknown", sessionId: "s-titled" },
      chatTitleLookups,
    );

    // Then
    expect(title).toBe("New chat");
  });

  it("uses the basename for a file tab", () => {
    // When
    const title = workbenchTabTitle(
      { kind: "file", workspaceId: WORKSPACE_ID, path: "src/lib/utils.ts" },
      chatTitleLookups,
    );

    // Then
    expect(title).toBe("utils.ts");
  });

  it("uses the stored title for a terminal tab", () => {
    // When
    const title = workbenchTabTitle(
      {
        kind: "terminal",
        workspaceId: WORKSPACE_ID,
        sessionId: "wb-term-1a2b3c4d",
        title: "Terminal 3",
      },
      chatTitleLookups,
    );

    // Then
    expect(title).toBe("Terminal 3");
  });

  it.each([
    ["staged", null, "a.ts (staged)"],
    ["working", null, "a.ts (working)"],
    ["compare", "main", "a.ts ↔ main"],
  ] as const)(
    "uses the diff title for a %s diff tab",
    (source, baseRef, expectedTitle) => {
      // When
      const title = workbenchTabTitle(
        {
          kind: "diff",
          workspaceId: WORKSPACE_ID,
          path: "src/a.ts",
          source,
          baseRef,
        },
        chatTitleLookups,
      );

      // Then
      expect(title).toBe(expectedTitle);
    },
  );

  it("uses New tab for a launcher tab", () => {
    // When
    const title = workbenchTabTitle(
      { kind: "launcher", workspaceId: WORKSPACE_ID },
      chatTitleLookups,
    );

    // Then
    expect(title).toBe("New tab");
  });
});
