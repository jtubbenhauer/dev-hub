import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  waitFor,
  cleanup,
  fireEvent,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PromptInput } from "@/components/chat/prompt-input";
import { useChatStore } from "@/stores/chat-store";
import { useHasCoarsePointer } from "@/hooks/use-mobile";
import type { MessageWithParts } from "@/lib/opencode/types";

const { suggestionSetting } = vi.hoisted(() => ({
  suggestionSetting: { isChatSuggestionsEnabled: true, isLoading: false },
}));

vi.mock("@/hooks/use-settings", () => ({
  useChatSuggestionsSetting: () => suggestionSetting,
}));
vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: vi.fn(() => false),
  useHasCoarsePointer: vi.fn(() => false),
}));
vi.mock("@/lib/comment-chat-bridge", () => ({
  getPendingCommentChips: vi.fn(() => []),
  clearPendingCommentChips: vi.fn(),
  getAllCachedComments: vi.fn(() => []),
}));
vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual("@tanstack/react-query");
  return { ...actual, useQueryClient: () => ({}) };
});
vi.mock("sonner", () => ({
  toast: { warning: vi.fn(), success: vi.fn(), error: vi.fn() },
}));
vi.mock("@/components/chat/file-picker", () => ({ FilePicker: () => null }));
vi.mock("@/components/chat/command-picker", () => ({
  CommandPicker: () => null,
}));
vi.mock("@/components/chat/plan-arg-picker", () => ({
  PlanArgPicker: () => null,
}));
vi.mock("@/components/chat/agent-selector", () => ({
  AgentSelector: () => null,
}));
vi.mock("@/components/chat/model-selector", () => ({
  ModelSelector: () => null,
}));
vi.mock("@/components/chat/variant-selector", () => ({
  VariantSelector: () => null,
}));
vi.mock("@/components/chat/pr-picker", () => ({ PrPicker: () => null }));
vi.mock("@/hooks/use-git", () => ({
  useWorkspaceGitHub: vi.fn().mockReturnValue(null),
}));

const mockHasCoarsePointer = useHasCoarsePointer as ReturnType<typeof vi.fn>;

const AGENT_TEXT =
  "Recommended next steps:\n- Tool data first.\n- Then the model misreadings.";
const TOP_REPLY = "Ok great. Let's do the recommended next steps.";

function makeTextMessage(
  id: string,
  role: "user" | "assistant",
  text: string,
): MessageWithParts {
  return {
    info: { id, role, sessionID: "sess-1" },
    parts: [
      { id: `${id}-p`, sessionID: "sess-1", messageID: id, type: "text", text },
    ],
  } as unknown as MessageWithParts;
}

// Each test uses a unique agent message id because replies are cached per id
function seedConversation(agentMessageId: string) {
  useChatStore.setState({
    workspaceStates: {
      "ws-1": {
        sessions: {},
        sessionsLoaded: true,
        optimisticMessageIds: {},
        sessionStatuses: {},
        permissions: [],
        questions: [],
        todos: {},
        sessionAgents: {},
        sessionModels: {},
        sessionVariants: {},
        lastViewedAt: {},
        pinnedSessionIds: new Set<string>(),
        sessionNotes: {},
        messages: {
          "sess-1": [
            makeTextMessage("u1", "user", "ok cool, run the sweep"),
            makeTextMessage(agentMessageId, "assistant", AGENT_TEXT),
          ],
        },
      },
    },
  });
}

const baseProps = {
  onSubmit: vi.fn(),
  onAbort: vi.fn(),
  isStreaming: false,
  disabled: false,
  workspaceId: "ws-1",
  sessionId: "sess-1",
  commands: [],
  onCommandSelect: vi.fn(),
  agents: [],
  selectedAgent: null,
  onAgentChange: vi.fn(),
  selectedModel: null,
  onModelChange: vi.fn(),
  availableVariants: [],
  selectedVariant: null,
  onVariantChange: vi.fn(),
};

function mockSuggestApi(handlers: {
  replies?: string[];
  completion?: (typedText: string) => string;
}) {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as {
      mode: string;
      typedText?: string;
    };
    const payload =
      body.mode === "replies"
        ? { replies: handlers.replies ?? [] }
        : { completion: handlers.completion?.(body.typedText ?? "") ?? "" };
    return new Response(JSON.stringify(payload), { status: 200 });
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

async function renderWithReplies(agentMessageId: string) {
  seedConversation(agentMessageId);
  const fetchMock = mockSuggestApi({ replies: [TOP_REPLY, "Why A15?"] });
  const user = userEvent.setup();
  render(<PromptInput {...baseProps} />);
  const textarea = screen.getByRole("textbox");
  await user.clear(textarea);
  return { user, textarea, fetchMock };
}

describe("PromptInput chat suggestions", () => {
  beforeEach(() => {
    localStorage.clear();
    suggestionSetting.isChatSuggestionsEnabled = true;
    mockHasCoarsePointer.mockReturnValue(false);
  });

  afterEach(() => {
    cleanup();
  });

  it("sends the agent message and user history when fetching replies", async () => {
    const { fetchMock } = await renderWithReplies("agent-request");
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(requestBody).toMatchObject({
      mode: "replies",
      lastAgentMessage: AGENT_TEXT,
      recentUserMessages: ["ok cool, run the sweep"],
    });
  });

  it("completes a typed prefix and accepts it with ArrowRight", async () => {
    const { user, textarea } = await renderWithReplies("agent-arrow");
    await user.type(textarea, "Ok");
    expect(
      await screen.findByTestId("chat-suggestion-ghost"),
    ).toHaveTextContent(TOP_REPLY);

    await user.keyboard("{ArrowRight}");
    expect(textarea).toHaveValue(TOP_REPLY);
    expect(screen.queryByTestId("chat-suggestion-ghost")).toBeNull();
  });

  it("leaves Tab alone so it can keep cycling agents", async () => {
    const { user, textarea } = await renderWithReplies("agent-tab");
    await user.type(textarea, "Ok");
    await screen.findByTestId("chat-suggestion-ghost");
    const isTabDefaultAllowed = fireEvent.keyDown(textarea, { key: "Tab" });
    expect(isTabDefaultAllowed).toBe(true);
    expect(textarea).toHaveValue("Ok");
  });

  it("accepts one word with Alt+ArrowRight and dismisses with Escape", async () => {
    const { user, textarea } = await renderWithReplies("agent-word");
    await user.type(textarea, "ok");
    await screen.findByTestId("chat-suggestion-ghost");
    await user.keyboard("{Alt>}{ArrowRight}{/Alt}");
    expect(textarea).toHaveValue("ok great. ");

    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("chat-suggestion-ghost")).toBeNull();
    await user.keyboard("{ArrowRight}");
    expect(textarea).toHaveValue("ok great. ");
  });

  it("offers the top reply in an empty box and hides the placeholder", async () => {
    const { user, textarea } = await renderWithReplies("agent-empty");
    expect(
      await screen.findByTestId("chat-suggestion-ghost"),
    ).toHaveTextContent(TOP_REPLY);
    expect(textarea).toHaveAttribute("placeholder", "");

    await user.click(textarea);
    await user.keyboard("{ArrowRight}");
    expect(textarea).toHaveValue(TOP_REPLY);
  });

  it("hides the suggestion when the caret is not at the end", async () => {
    const { user, textarea } = await renderWithReplies("agent-caret");
    await user.type(textarea, "Ok");
    await screen.findByTestId("chat-suggestion-ghost");

    await user.keyboard("{ArrowLeft}");
    expect(screen.queryByTestId("chat-suggestion-ghost")).toBeNull();

    await user.keyboard("{End}");
    expect(
      await screen.findByTestId("chat-suggestion-ghost"),
    ).toBeInTheDocument();
  });

  it("hides the suggestion while an IME composition is in progress", async () => {
    const { user, textarea } = await renderWithReplies("agent-ime");
    await user.type(textarea, "Ok");
    await screen.findByTestId("chat-suggestion-ghost");

    fireEvent.compositionStart(textarea);
    expect(screen.queryByTestId("chat-suggestion-ghost")).toBeNull();
    fireEvent.compositionEnd(textarea);
    expect(screen.getByTestId("chat-suggestion-ghost")).toBeInTheDocument();
  });

  it("shows the → hint until three suggestions have been accepted", async () => {
    localStorage.setItem("dev-hub-chat-suggestion-accepts", "2");
    const { user, textarea } = await renderWithReplies("agent-hint");
    await user.type(textarea, "Ok");
    expect(
      await screen.findByTestId("chat-suggestion-hint"),
    ).toBeInTheDocument();

    await user.keyboard("{ArrowRight}");
    expect(localStorage.getItem("dev-hub-chat-suggestion-accepts")).toBe("3");
    await user.clear(textarea);
    await user.type(textarea, "Wh");
    await screen.findByTestId("chat-suggestion-ghost");
    expect(screen.queryByTestId("chat-suggestion-hint")).toBeNull();
  });

  it("requests a live completion when typing diverges from the replies", async () => {
    seedConversation("agent-live");
    const fetchMock = mockSuggestApi({
      replies: [TOP_REPLY],
      completion: (typedText) =>
        typedText === "The model mis"
          ? "readings should be done first, and then the tool data"
          : "",
    });
    const user = userEvent.setup();
    render(<PromptInput {...baseProps} />);
    const textarea = screen.getByRole("textbox");
    await user.clear(textarea);

    await user.type(textarea, "The model mis");
    expect(
      await screen.findByTestId("chat-suggestion-ghost", {}, { timeout: 2000 }),
    ).toHaveTextContent(
      "The model misreadings should be done first, and then the tool data",
    );
    const completionBodies = fetchMock.mock.calls
      .map(([, init]) => JSON.parse(String(init?.body)))
      .filter((body) => body.mode === "complete");
    expect(completionBodies.at(-1)?.typedText).toBe("The model mis");

    await user.keyboard("{ArrowRight}");
    expect(textarea).toHaveValue(
      "The model misreadings should be done first, and then the tool data",
    );
  });

  it("does not request suggestions while the agent is streaming", async () => {
    seedConversation("agent-streaming");
    const fetchMock = mockSuggestApi({ replies: [TOP_REPLY] });
    render(<PromptInput {...baseProps} isStreaming />);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not request suggestions when the setting is disabled", async () => {
    suggestionSetting.isChatSuggestionsEnabled = false;
    seedConversation("agent-disabled");
    const fetchMock = mockSuggestApi({ replies: [TOP_REPLY] });
    const user = userEvent.setup();
    render(<PromptInput {...baseProps} />);
    const textarea = screen.getByRole("textbox");
    await user.clear(textarea);
    await user.type(textarea, "Ok");
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId("chat-suggestion-ghost")).toBeNull();
  });

  it("shows tappable reply chips instead of ghost text on touch devices", async () => {
    mockHasCoarsePointer.mockReturnValue(true);
    const { user, textarea } = await renderWithReplies("agent-mobile");

    const chips = await screen.findByTestId("chat-suggestion-chips");
    expect(screen.queryByTestId("chat-suggestion-ghost")).toBeNull();
    await user.click(screen.getByRole("button", { name: TOP_REPLY }));
    expect(textarea).toHaveValue(TOP_REPLY);
    expect(chips).not.toBeInTheDocument();
  });
});
