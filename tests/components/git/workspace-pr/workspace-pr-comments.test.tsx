import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WorkspacePrComments } from "@/components/git/workspace-pr/workspace-pr-comments";
import type { PullRequestFeedback } from "@/lib/github/pull-request-feedback";
import type { OpenChatInWorkbenchInput } from "@/lib/workbench/open-in-workbench";
import {
  makeComment,
  makePullRequest,
  makeReview,
  makeThread,
} from "./workspace-pr-fixtures";

const chatBridge = vi.hoisted(() => ({
  queueTextForChat: vi.fn<(workspaceId: string, text: string) => void>(),
  openChatInWorkbench: vi.fn<(input: OpenChatInWorkbenchInput) => void>(),
  toastSuccess: vi.fn(),
  pushMock: vi.fn(),
}));

const feedbackQuery = vi.hoisted(() => ({
  current: {
    data: undefined as PullRequestFeedback | undefined,
    error: null as Error | null,
  },
}));

vi.mock("@/lib/terminal-chat-bridge", () => ({
  queueTextForChat: chatBridge.queueTextForChat,
}));
vi.mock("@/lib/workbench/open-in-workbench", () => ({
  openChatInWorkbench: chatBridge.openChatInWorkbench,
}));
vi.mock("sonner", () => ({
  toast: { success: chatBridge.toastSuccess, error: vi.fn() },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: chatBridge.pushMock }),
  usePathname: () => "/",
}));
vi.mock("@/hooks/use-branch-pull-request", () => ({
  usePullRequestFeedback: () => feedbackQuery.current,
}));

const parserThread = makeThread({
  id: "t1",
  path: "src/lib/parser.ts",
  line: 42,
  comments: [
    makeComment({ id: "t1-c1", body: "Handle the empty input case here." }),
    makeComment({ id: "t1-c2", body: "Agreed, it throws today." }),
  ],
});
const routesThread = makeThread({
  id: "t2",
  path: "app/routes.ts",
  line: 7,
  comments: [makeComment({ id: "t2-c1", body: "Rename this route." })],
});
const resolvedThread = makeThread({
  id: "t3",
  path: "README.md",
  isResolved: true,
  comments: [makeComment({ id: "t3-c1", body: "Typo fixed already." })],
});

function renderComments(feedback: PullRequestFeedback | undefined) {
  feedbackQuery.current = { data: feedback, error: null };
  const onSentToChat = vi.fn();
  render(
    <WorkspacePrComments
      workspaceId="ws-1"
      owner="acme"
      repo="widgets"
      pullRequest={makePullRequest()}
      nameWithOwner="acme/widgets"
      onSentToChat={onSentToChat}
    />,
  );
  return { onSentToChat };
}

function sentChatText(): string {
  const call = chatBridge.queueTextForChat.mock.lastCall;
  if (!call) throw new Error("queueTextForChat was never called");
  return call[1];
}

describe("WorkspacePrComments", () => {
  beforeEach(() => {
    chatBridge.queueTextForChat.mockReset();
    chatBridge.openChatInWorkbench.mockReset();
    chatBridge.toastSuccess.mockReset();
  });

  it("sends one thread to the workspace chat, opens the chat, then closes", async () => {
    const user = userEvent.setup();
    const { onSentToChat } = renderComments({
      unresolvedThreads: [parserThread, routesThread],
      resolvedThreads: [],
      conversation: [],
    });

    const parserCard = screen.getByTitle("src/lib/parser.ts:42").closest("li");
    if (!parserCard) throw new Error("thread card not found");
    await user.click(
      within(parserCard).getByRole("button", { name: "Send to chat" }),
    );

    expect(chatBridge.queueTextForChat).toHaveBeenCalledOnce();
    expect(chatBridge.queueTextForChat.mock.lastCall?.[0]).toBe("ws-1");
    expect(sentChatText()).toContain("src/lib/parser.ts:42");
    expect(sentChatText()).toContain("Handle the empty input case here.");
    expect(sentChatText()).not.toContain("app/routes.ts");
    expect(chatBridge.openChatInWorkbench).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "ws-1", sessionId: null }),
    );
    expect(
      chatBridge.queueTextForChat.mock.invocationCallOrder[0],
    ).toBeLessThan(chatBridge.openChatInWorkbench.mock.invocationCallOrder[0]);
    expect(chatBridge.toastSuccess).toHaveBeenCalledWith("Added to chat");
    expect(onSentToChat).toHaveBeenCalledOnce();
  });

  it("sends every unresolved thread with Send all to chat", async () => {
    const user = userEvent.setup();
    renderComments({
      unresolvedThreads: [parserThread, routesThread],
      resolvedThreads: [resolvedThread],
      conversation: [],
    });

    await user.click(screen.getByRole("button", { name: "Send all to chat" }));

    expect(sentChatText()).toContain("src/lib/parser.ts:42");
    expect(sentChatText()).toContain("app/routes.ts:7");
    expect(sentChatText()).not.toContain("README.md");
  });

  it("sends a review summary from the conversation", async () => {
    const user = userEvent.setup();
    renderComments({
      unresolvedThreads: [],
      resolvedThreads: [],
      conversation: [
        makeReview({ id: "r1", body: "Needs tests before merging." }),
      ],
    });

    expect(screen.getByText("requested changes")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Send to chat" }));

    expect(sentChatText()).toContain("Needs tests before merging.");
    expect(sentChatText()).toContain("requested changes");
  });

  it("reveals replies and keeps resolved threads collapsed until asked", async () => {
    const user = userEvent.setup();
    renderComments({
      unresolvedThreads: [parserThread],
      resolvedThreads: [resolvedThread],
      conversation: [],
    });

    expect(
      screen.queryByText("Agreed, it throws today."),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "1 reply" }));
    expect(screen.getByText("Agreed, it throws today.")).toBeInTheDocument();

    expect(screen.queryByText("Typo fixed already.")).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: /Resolved threads \(1\)/ }),
    );
    expect(screen.getByText("Typo fixed already.")).toBeInTheDocument();
  });

  it("shows the empty state", () => {
    renderComments({
      unresolvedThreads: [],
      resolvedThreads: [],
      conversation: [],
    });
    expect(screen.getByText("No comments yet")).toBeInTheDocument();
  });

  it("shows the feedback error message", () => {
    feedbackQuery.current = {
      data: undefined,
      error: new Error("GraphQL rate limit exceeded"),
    };
    render(
      <WorkspacePrComments
        workspaceId="ws-1"
        owner="acme"
        repo="widgets"
        pullRequest={makePullRequest()}
        nameWithOwner="acme/widgets"
        onSentToChat={vi.fn()}
      />,
    );

    expect(screen.getByText("GraphQL rate limit exceeded")).toBeInTheDocument();
  });
});
