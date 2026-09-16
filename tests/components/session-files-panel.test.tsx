import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SessionFilesPanel } from "@/components/chat/session-files-panel";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { MessageWithParts } from "@/lib/opencode/types";

const {
  mockOpenFile,
  mockRouterPush,
  mockOpenFileInSidePanel,
  mockSetFileViewMode,
  mockToastError,
} = vi.hoisted(() => ({
  mockOpenFile: vi.fn().mockResolvedValue(undefined),
  mockRouterPush: vi.fn(),
  mockOpenFileInSidePanel: vi.fn().mockResolvedValue(undefined),
  mockSetFileViewMode: vi.fn(),
  mockToastError: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockRouterPush }),
}));

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => true,
}));

vi.mock("@/hooks/use-settings", () => ({
  useChatFileOpenSetting: () => ({
    fileOpenMode: "dialog",
    isLoading: false,
  }),
}));

vi.mock("@/stores/workspace-store", () => ({
  useWorkspaceStore: (
    selector: (state: { activeWorkspaceId: string }) => unknown,
  ) => selector({ activeWorkspaceId: "workspace-1" }),
}));

vi.mock("@/stores/chat-file-dialog-store", () => ({
  useChatFileDialogStore: Object.assign(vi.fn(), {
    getState: () => ({ openFile: mockOpenFile }),
  }),
}));

vi.mock("@/stores/side-panel-store", () => ({
  useSidePanelStore: Object.assign(vi.fn(), {
    getState: () => ({ setFileViewMode: mockSetFileViewMode }),
  }),
}));

vi.mock("@/lib/side-panel-open-file", () => ({
  openFileInSidePanel: mockOpenFileInSidePanel,
}));

vi.mock("sonner", () => ({
  toast: { error: mockToastError },
}));

function makePart(filePath: string, id: string, callID: string) {
  return {
    id,
    sessionID: "session-1",
    messageID: "message-1",
    type: "tool" as const,
    callID,
    tool: "write",
    state: {
      status: "completed" as const,
      input: { filePath },
      output: "",
      title: "",
      metadata: {},
      time: { start: 1, end: 2 },
    },
  };
}

function makeMessage(
  filePaths: string[] = ["/workspace/src/example.ts"],
): MessageWithParts {
  return {
    info: {
      id: "message-1",
      sessionID: "session-1",
      role: "assistant",
      time: { created: 1 },
      parentID: "",
      modelID: "",
      providerID: "",
      mode: "",
      path: { cwd: "/workspace", root: "/workspace" },
      cost: 0,
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
    },
    parts: filePaths.map((fp, i) => makePart(fp, `part-${i}`, `call-${i}`)),
  };
}

function renderPanel(message: MessageWithParts, onFileOpen = vi.fn()) {
  render(
    <TooltipProvider>
      <SessionFilesPanel
        messages={[message]}
        workspacePath="/workspace"
        onFileOpen={onFileOpen}
      />
    </TooltipProvider>,
  );
  return { onFileOpen };
}

describe("SessionFilesPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOpenFileInSidePanel.mockResolvedValue(undefined);
  });

  it("closes the mobile sheet before opening a file dialog", async () => {
    const { onFileOpen } = renderPanel(makeMessage());

    fireEvent.click(screen.getByRole("button", { name: /src\/example[.]ts/ }));

    await waitFor(() => expect(mockOpenFile).toHaveBeenCalledOnce());
    expect(onFileOpen).toHaveBeenCalledOnce();
  });

  it("opens the file in the side panel diff mode on GitCompare click", async () => {
    renderPanel(makeMessage());

    fireEvent.click(screen.getByTitle("Open in git diff"));

    await waitFor(() =>
      expect(mockOpenFileInSidePanel).toHaveBeenCalledWith(
        "workspace-1",
        "src/example.ts",
        expect.any(Function),
      ),
    );
    expect(mockSetFileViewMode).toHaveBeenCalledWith(
      "workspace-1:src/example.ts",
      "diff",
    );
    expect(mockRouterPush).not.toHaveBeenCalled();
  });

  it("does not set diff mode when opening the file fails", async () => {
    mockOpenFileInSidePanel.mockImplementationOnce(
      async (_workspaceId: string, _path: string, fallback: () => void) => {
        fallback();
      },
    );
    renderPanel(makeMessage());

    fireEvent.click(screen.getByTitle("Open in git diff"));

    await waitFor(() => expect(mockToastError).toHaveBeenCalledOnce());
    expect(mockSetFileViewMode).not.toHaveBeenCalled();
    expect(mockRouterPush).not.toHaveBeenCalled();
  });

  it("renders no GitCompare icon for outside-repo paths", () => {
    renderPanel(
      makeMessage([
        "/abs/f.ts",
        "C:\\outside\\f.ts",
        "\\\\server\\share\\f.ts",
        "../outside.ts",
      ]),
    );

    expect(screen.getAllByRole("button")).toHaveLength(4);
    expect(screen.queryAllByTitle("Open in git diff")).toHaveLength(0);
  });
});
