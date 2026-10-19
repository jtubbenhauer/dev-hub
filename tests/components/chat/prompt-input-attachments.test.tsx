import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  act,
  render,
  cleanup,
  fireEvent,
  screen,
  waitFor,
} from "@testing-library/react";
import { toast } from "sonner";
import { PromptInput } from "@/components/chat/prompt-input";
import { WORKSPACE_UPLOADS_CONTEXT_PREFIX } from "@/lib/attachment-utils";

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: vi.fn(() => false),
  useHasCoarsePointer: vi.fn(() => false),
}));

vi.mock("@/lib/comment-chat-bridge", () => ({
  getPendingCommentChips: vi.fn(() => []),
  clearPendingCommentChips: vi.fn(),
  removePendingCommentChip: vi.fn(),
  attachCommentToChat: vi.fn(),
  getAllCachedComments: vi.fn(() => []),
}));

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual("@tanstack/react-query");
  return {
    ...actual,
    useQueryClient: () => ({
      getQueryData: vi.fn(() => undefined),
      getQueriesData: vi.fn(() => []),
    }),
  };
});

vi.mock("sonner", () => ({
  toast: { warning: vi.fn(), success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/components/chat/file-picker", () => ({
  FilePicker: () => null,
}));
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
vi.mock("@/components/chat/omo-permission-preset-selector", () => ({
  OmoPermissionPresetSelector: () => null,
}));
vi.mock("@/components/chat/context-usage-indicator", () => ({
  ContextUsageIndicator: () => null,
}));
vi.mock("@/hooks/use-settings", () => ({
  useModelAllowlist: () => ({ allowlist: [], setAllowlist: vi.fn() }),
  useChatSuggestionsSetting: () => ({
    isChatSuggestionsEnabled: false,
    isLoading: false,
  }),
}));
vi.mock("@/hooks/use-git", () => ({
  useWorkspaceGitHub: vi.fn().mockReturnValue(null),
}));
vi.mock("@/components/chat/pr-picker", () => ({
  PrPicker: () => null,
}));

const baseProps = {
  onAbort: vi.fn(),
  isStreaming: false,
  disabled: false,
  workspaceId: "ws-1",
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

const SAVED_PATH = ".devhub/uploads/20261013-013045-3f9a2c-big.json";
const LARGE_FILE_BYTES = 300 * 1024;

function createJsonFile(name: string, byteLength: number): File {
  return new File(["a".repeat(byteLength)], name, {
    type: "application/json",
  });
}

function getTextarea(container: HTMLElement): HTMLTextAreaElement {
  const textarea = container.querySelector("textarea");
  if (!textarea) throw new Error("textarea not rendered");
  return textarea;
}

async function attachFile(container: HTMLElement, file: File) {
  const fileInput =
    container.querySelector<HTMLInputElement>('input[type="file"]');
  if (!fileInput) throw new Error("file input not rendered");
  fireEvent.change(fileInput, { target: { files: [file] } });
  await screen.findByLabelText(`Remove ${file.name}`);
}

function typeAndPressEnter(container: HTMLElement, text: string) {
  const textarea = getTextarea(container);
  fireEvent.change(textarea, { target: { value: text } });
  fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });
}

function uploadResponse(): Response {
  return new Response(
    JSON.stringify({ path: SAVED_PATH, sizeBytes: LARGE_FILE_BYTES }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function stubPendingUpload() {
  let resolveUpload: (response: Response) => void = () => {};
  const fetchMock = vi.fn<typeof fetch>(
    () =>
      new Promise<Response>((resolve) => {
        resolveUpload = resolve;
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return {
    fetchMock,
    finishUpload: () =>
      act(async () => {
        resolveUpload(uploadResponse());
      }),
  };
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("PromptInput — large text attachments", () => {
  it("sends text attachments under the inline limit without uploading them", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    const onSubmit = vi.fn();
    const { container } = render(
      <PromptInput
        {...baseProps}
        onSubmit={onSubmit}
        sessionId="session-small"
      />,
    );

    await attachFile(container, createJsonFile("small.json", 1024));
    typeAndPressEnter(container, "summarise this");

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(fetchMock).not.toHaveBeenCalled();
    const [text, attachments] = onSubmit.mock.calls[0];
    expect(text).toBe("summarise this");
    expect(attachments).toEqual([
      expect.objectContaining({ filename: "small.json" }),
    ]);
  });

  it("saves a text attachment over the inline limit to the workspace and references it", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => uploadResponse());
    vi.stubGlobal("fetch", fetchMock);
    const onSubmit = vi.fn();
    const { container } = render(
      <PromptInput
        {...baseProps}
        onSubmit={onSubmit}
        sessionId="session-upload"
      />,
    );

    await attachFile(container, createJsonFile("big.json", LARGE_FILE_BYTES));
    typeAndPressEnter(container, "what is in this?");

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/files/upload");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      workspaceId: "ws-1",
      filename: "big.json",
    });
    const [text, attachments] = onSubmit.mock.calls[0];
    expect(text.startsWith(WORKSPACE_UPLOADS_CONTEXT_PREFIX)).toBe(true);
    expect(text).toContain(`- "big.json" (300KB): ${SAVED_PATH}`);
    expect(text.endsWith("\n\nwhat is in this?")).toBe(true);
    expect(attachments).toBeUndefined();
    expect(screen.queryByLabelText("Remove big.json")).toBeNull();
    expect(getTextarea(container).value).toBe("");
  });

  it("keeps the message and files when saving to the workspace fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(
        async () =>
          new Response(JSON.stringify({ error: "Agent request failed: 502" }), {
            status: 500,
          }),
      ),
    );
    const onSubmit = vi.fn();
    const { container } = render(
      <PromptInput
        {...baseProps}
        onSubmit={onSubmit}
        sessionId="session-failure"
      />,
    );

    await attachFile(container, createJsonFile("big.json", LARGE_FILE_BYTES));
    typeAndPressEnter(container, "what is in this?");

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'Failed to save "big.json" to the workspace: Agent request failed: 502',
      ),
    );
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Remove big.json")).toBeInTheDocument();
    expect(getTextarea(container).value).toBe("what is in this?");
    expect(getTextarea(container).readOnly).toBe(false);
  });

  it("locks the message while saving, sends it once, and keeps files attached meanwhile", async () => {
    const { fetchMock, finishUpload } = stubPendingUpload();
    const onSubmit = vi.fn();
    const { container } = render(
      <PromptInput
        {...baseProps}
        onSubmit={onSubmit}
        sessionId="session-lock"
      />,
    );

    await attachFile(container, createJsonFile("big.json", LARGE_FILE_BYTES));
    typeAndPressEnter(container, "what is in this?");

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Saving large files to the workspace",
    );
    expect(getTextarea(container).readOnly).toBe(true);
    fireEvent.keyDown(getTextarea(container), { key: "Enter" });
    await attachFile(container, createJsonFile("next.json", 1024));

    await finishUpload();

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][1]).toBeUndefined();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByLabelText("Remove big.json")).toBeNull();
    expect(screen.getByLabelText("Remove next.json")).toBeInTheDocument();
  });

  it("sends to the original session and leaves the other session's draft alone after switching mid-upload", async () => {
    const { finishUpload } = stubPendingUpload();
    const onSubmit = vi.fn();
    const { container, rerender } = render(
      <PromptInput
        {...baseProps}
        onSubmit={onSubmit}
        sessionId="session-other"
      />,
    );
    fireEvent.change(getTextarea(container), {
      target: { value: "draft for the other session" },
    });
    rerender(
      <PromptInput
        {...baseProps}
        onSubmit={onSubmit}
        sessionId="session-origin"
      />,
    );

    await attachFile(container, createJsonFile("big.json", LARGE_FILE_BYTES));
    typeAndPressEnter(container, "what is in this?");
    await screen.findByRole("status");
    rerender(
      <PromptInput
        {...baseProps}
        onSubmit={onSubmit}
        sessionId="session-other"
      />,
    );
    await finishUpload();

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toContain("what is in this?");
    expect(getTextarea(container).value).toBe("draft for the other session");

    rerender(
      <PromptInput
        {...baseProps}
        onSubmit={onSubmit}
        sessionId="session-origin"
      />,
    );
    expect(getTextarea(container).value).toBe("");
    expect(screen.queryByLabelText("Remove big.json")).toBeNull();
  });
});
