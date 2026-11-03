import { describe, expect, it } from "vitest";
import {
  NOTIFICATION_BODY_MAX_LENGTH,
  NOTIFICATION_PATTERN_MAX_LENGTH,
  UNKNOWN_WORKSPACE_LABEL,
  UNTITLED_SESSION_LABEL,
  buildErrorNotification,
  buildFinishedNotification,
  buildPermissionNotification,
  buildQuestionNotification,
  truncateNotificationText,
} from "@/lib/attention/notification-content";
import type { PermissionRequest, QuestionRequest } from "@/lib/opencode/types";
import { createWorkbenchHref } from "@/lib/workbench/workbench-href";

const sharedInput = {
  workspaceId: "ws-1",
  workspaceName: "QA Workspace",
  rootSessionId: "root-1",
  rootTitle: "QA Root",
};

const ROOT_CHAT_HREF = createWorkbenchHref({
  open: "chat",
  workspaceId: "ws-1",
  sessionId: "root-1",
});

function createPermission(
  overrides: Partial<PermissionRequest> = {},
): PermissionRequest {
  return {
    id: "perm-1",
    sessionID: "child-1",
    permission: "bash",
    patterns: ["git push origin main"],
    metadata: {},
    always: [],
    ...overrides,
  };
}

function createQuestion(
  questions: { question: string; header: string }[],
  overrides: Partial<QuestionRequest> = {},
): QuestionRequest {
  return {
    id: "q-1",
    sessionID: "child-1",
    questions: questions.map((entry) => ({ ...entry, options: [] })),
    ...overrides,
  };
}

describe("truncateNotificationText", () => {
  it("collapses whitespace and trims", () => {
    expect(truncateNotificationText("  a \n\t b   c  ", 50)).toBe("a b c");
  });

  it("returns text unchanged when exactly at the limit", () => {
    expect(truncateNotificationText("abcde", 5)).toBe("abcde");
  });

  it("truncates with an ellipsis when over the limit", () => {
    expect(truncateNotificationText("abcdef", 5)).toBe("abcd…");
  });
});

describe("buildFinishedNotification", () => {
  it("builds title, body, tag and href", () => {
    expect(buildFinishedNotification(sharedInput)).toEqual({
      title: "QA Root finished",
      body: "QA Workspace · Ready for your next message",
      tag: "devhub-finished-root-1",
      targetHref: ROOT_CHAT_HREF,
    });
  });

  it("falls back to the untitled label when the title is whitespace", () => {
    const content = buildFinishedNotification({
      ...sharedInput,
      rootTitle: "   ",
    });
    expect(content.title).toBe(`${UNTITLED_SESSION_LABEL} finished`);
    expect(UNTITLED_SESSION_LABEL).toBe("Untitled session");
  });

  it("falls back to the untitled label when the title is null", () => {
    const content = buildFinishedNotification({
      ...sharedInput,
      rootTitle: null,
    });
    expect(content.title).toBe("Untitled session finished");
  });

  it("falls back to the workspace label when the workspace name is null", () => {
    const content = buildFinishedNotification({
      ...sharedInput,
      workspaceName: null,
    });
    expect(content.body).toBe("Workspace · Ready for your next message");
    expect(UNKNOWN_WORKSPACE_LABEL).toBe("Workspace");
  });

  it("falls back to the workspace label when the workspace name is empty", () => {
    const content = buildFinishedNotification({
      ...sharedInput,
      workspaceName: "",
    });
    expect(content.body).toBe("Workspace · Ready for your next message");
  });
});

describe("buildPermissionNotification", () => {
  it("names the subagent requester and the permission", () => {
    const content = buildPermissionNotification({
      ...sharedInput,
      permission: createPermission(),
      requesterTitle: "QA Child",
    });
    expect(content).toEqual({
      title: "Approval needed: QA Root",
      body: 'QA Workspace · Subagent "QA Child" wants bash: git push origin main',
      tag: "devhub-permission-perm-1",
      targetHref: ROOT_CHAT_HREF,
    });
  });

  it("uses Agent when there is no requester title", () => {
    const content = buildPermissionNotification({
      ...sharedInput,
      permission: createPermission(),
      requesterTitle: null,
    });
    expect(content.body).toBe(
      "QA Workspace · Agent wants bash: git push origin main",
    );
  });

  it("uses Agent when the requester title is blank", () => {
    const content = buildPermissionNotification({
      ...sharedInput,
      permission: createPermission(),
      requesterTitle: "  ",
    });
    expect(content.body).toContain("Agent wants");
  });

  it("shows only the permission name when there are no patterns", () => {
    const content = buildPermissionNotification({
      ...sharedInput,
      permission: createPermission({ patterns: [] }),
      requesterTitle: null,
    });
    expect(content.body).toBe("QA Workspace · Agent wants bash");
  });

  it("shows three patterns and a more-count when there are five", () => {
    const content = buildPermissionNotification({
      ...sharedInput,
      permission: createPermission({
        permission: "edit",
        patterns: ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"],
      }),
      requesterTitle: null,
    });
    expect(content.body).toBe(
      "QA Workspace · Agent wants edit: a.ts, b.ts, c.ts (+2 more)",
    );
  });

  it("does not add a more-count for exactly three patterns", () => {
    const content = buildPermissionNotification({
      ...sharedInput,
      permission: createPermission({
        permission: "edit",
        patterns: ["a.ts", "b.ts", "c.ts"],
      }),
      requesterTitle: null,
    });
    expect(content.body).toBe(
      "QA Workspace · Agent wants edit: a.ts, b.ts, c.ts",
    );
  });

  it("truncates a 300-char pattern to 60 chars ending in an ellipsis", () => {
    const content = buildPermissionNotification({
      ...sharedInput,
      permission: createPermission({ patterns: ["x".repeat(300)] }),
      requesterTitle: null,
    });
    const expectedPattern = `${"x".repeat(NOTIFICATION_PATTERN_MAX_LENGTH - 1)}…`;
    expect(content.body).toBe(
      `QA Workspace · Agent wants bash: ${expectedPattern}`,
    );
    expect(expectedPattern).toHaveLength(60);
  });

  it("never lets the body exceed 180 chars", () => {
    const content = buildPermissionNotification({
      ...sharedInput,
      workspaceName: "W".repeat(100),
      permission: createPermission({
        patterns: ["p".repeat(300), "q".repeat(300), "r".repeat(300)],
      }),
      requesterTitle: "S".repeat(200),
    });
    expect(content.body).toHaveLength(NOTIFICATION_BODY_MAX_LENGTH);
    expect(content.body.endsWith("…")).toBe(true);
  });

  it("falls back to untitled and workspace labels", () => {
    const content = buildPermissionNotification({
      ...sharedInput,
      workspaceName: null,
      rootTitle: "",
      permission: createPermission(),
      requesterTitle: null,
    });
    expect(content.title).toBe("Approval needed: Untitled session");
    expect(content.body.startsWith("Workspace · ")).toBe(true);
  });
});

describe("buildQuestionNotification", () => {
  it("uses the first question text", () => {
    const content = buildQuestionNotification({
      ...sharedInput,
      question: createQuestion([
        { question: "Which branch?", header: "Branch" },
      ]),
      requesterTitle: null,
    });
    expect(content).toEqual({
      title: "Question from QA Root",
      body: "QA Workspace · Which branch?",
      tag: "devhub-question-q-1",
      targetHref: ROOT_CHAT_HREF,
    });
  });

  it("falls back to the header when the question text is blank", () => {
    const content = buildQuestionNotification({
      ...sharedInput,
      question: createQuestion([{ question: "   ", header: "Branch" }]),
      requesterTitle: null,
    });
    expect(content.body).toBe("QA Workspace · Branch");
  });

  it("falls back to the default text when question and header are blank", () => {
    const content = buildQuestionNotification({
      ...sharedInput,
      question: createQuestion([{ question: "", header: " " }]),
      requesterTitle: null,
    });
    expect(content.body).toBe(
      "QA Workspace · The agent has a question for you",
    );
  });

  it("falls back to the default text when there are no questions", () => {
    const content = buildQuestionNotification({
      ...sharedInput,
      question: createQuestion([]),
      requesterTitle: null,
    });
    expect(content.body).toBe(
      "QA Workspace · The agent has a question for you",
    );
  });

  it("prefixes the subagent title", () => {
    const content = buildQuestionNotification({
      ...sharedInput,
      question: createQuestion([{ question: "Which branch?", header: "B" }]),
      requesterTitle: "QA Child",
    });
    expect(content.body).toBe(
      'QA Workspace · Subagent "QA Child": Which branch?',
    );
  });

  it("never lets the body exceed 180 chars", () => {
    const content = buildQuestionNotification({
      ...sharedInput,
      question: createQuestion([{ question: "q".repeat(500), header: "H" }]),
      requesterTitle: null,
    });
    expect(content.body).toHaveLength(NOTIFICATION_BODY_MAX_LENGTH);
  });
});

describe("buildErrorNotification", () => {
  it("builds a workspace-level error when there is no session", () => {
    const content = buildErrorNotification({
      workspaceId: "ws-1",
      workspaceName: "QA Workspace",
      rootSessionId: null,
      rootTitle: null,
      message: null,
    });
    expect(content).toEqual({
      title: "Error in QA Workspace",
      body: "QA Workspace · An error occurred.",
      tag: "devhub-error-workspace-ws-1",
      targetHref: createWorkbenchHref({
        open: "chat",
        workspaceId: "ws-1",
        sessionId: null,
      }),
    });
  });

  it("uses the workspace fallback label when there is no session or name", () => {
    const content = buildErrorNotification({
      workspaceId: "ws-1",
      workspaceName: null,
      rootSessionId: null,
      rootTitle: null,
      message: "boom",
    });
    expect(content.title).toBe("Error in Workspace");
    expect(content.body).toBe("Workspace · boom");
  });

  it("builds a session-level error with the trimmed message", () => {
    const content = buildErrorNotification({
      workspaceId: "ws-1",
      workspaceName: "QA Workspace",
      rootSessionId: "root-1",
      rootTitle: "QA Root",
      message: "  Rate limit hit  ",
    });
    expect(content).toEqual({
      title: "Error in QA Root",
      body: "QA Workspace · Rate limit hit",
      tag: "devhub-error-root-1",
      targetHref: ROOT_CHAT_HREF,
    });
  });

  it("uses the default message when the message is blank", () => {
    const content = buildErrorNotification({
      workspaceId: "ws-1",
      workspaceName: "QA Workspace",
      rootSessionId: "root-1",
      rootTitle: "",
      message: "   ",
    });
    expect(content.title).toBe("Error in Untitled session");
    expect(content.body).toBe("QA Workspace · An error occurred.");
  });

  it("never lets the body exceed 180 chars", () => {
    const content = buildErrorNotification({
      workspaceId: "ws-1",
      workspaceName: "QA Workspace",
      rootSessionId: "root-1",
      rootTitle: "QA Root",
      message: "e".repeat(1000),
    });
    expect(content.body).toHaveLength(NOTIFICATION_BODY_MAX_LENGTH);
  });
});
