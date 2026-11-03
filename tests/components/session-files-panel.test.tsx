import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SessionFilesPanel } from "@/components/chat/session-files-panel";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { ChatFileOpenMode } from "@/hooks/use-settings";
import type { MessageWithParts } from "@/lib/opencode/types";
import type { OpenFileInWorkbenchInput } from "@/lib/workbench/open-in-workbench";
import { createWorkbenchHref } from "@/lib/workbench/workbench-href";
import { useEditorStore } from "@/stores/editor-store";

const {
  mockOpenFile,
  mockRouterPush,
  mockOpenFileInWorkbench,
  mockToastError,
  settings,
} = vi.hoisted(() => ({
  mockOpenFile:
    vi.fn<
      (workspaceId: string, path: string, fallback: () => void) => Promise<void>
    >(),
  mockRouterPush: vi.fn<(href: string) => void>(),
  mockOpenFileInWorkbench: vi.fn<
    (input: OpenFileInWorkbenchInput) => Promise<boolean>
  >(async () => true),
  mockToastError: vi.fn(),
  settings: { fileOpenMode: "dialog" as ChatFileOpenMode },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockRouterPush }),
}));

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => true,
}));

vi.mock("@/hooks/use-settings", () => ({
  useChatFileOpenSetting: () => ({
    fileOpenMode: settings.fileOpenMode,
    isLoading: false,
  }),
  useFileTabsSetting: () => ({ isFileTabsDisabled: true, isLoading: false }),
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

vi.mock("@/lib/workbench/open-in-workbench", () => ({
  openFileInWorkbench: mockOpenFileInWorkbench,
}));

vi.mock("sonner", () => ({
  toast: { error: mockToastError },
}));

const VIEW_MODE_KEY = "workspace-1:src/example.ts";

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
    settings.fileOpenMode = "dialog";
    mockOpenFileInWorkbench.mockResolvedValue(true);
    useEditorStore.setState({ fileViewModes: {} });
  });

  it("closes the mobile sheet before opening a file dialog", async () => {
    const { onFileOpen } = renderPanel(makeMessage());

    fireEvent.click(screen.getByRole("button", { name: /src\/example[.]ts/ }));

    await waitFor(() => expect(mockOpenFile).toHaveBeenCalledOnce());
    expect(onFileOpen).toHaveBeenCalledOnce();
    expect(mockOpenFileInWorkbench).not.toHaveBeenCalled();
  });

  it("falls back to the workbench file intent when the dialog cannot open the file", async () => {
    renderPanel(makeMessage());
    fireEvent.click(screen.getByRole("button", { name: /src\/example[.]ts/ }));
    await waitFor(() => expect(mockOpenFile).toHaveBeenCalledOnce());
    const fallback = mockOpenFile.mock.lastCall?.[2];

    fallback?.();

    expect(mockRouterPush).toHaveBeenCalledExactlyOnceWith(
      createWorkbenchHref({
        open: "file",
        workspaceId: "workspace-1",
        path: "src/example.ts",
      }),
    );
  });

  it("closes the mobile sheet and opens a workbench tab in sidebar mode", async () => {
    settings.fileOpenMode = "sidebar";
    const { onFileOpen } = renderPanel(makeMessage());

    fireEvent.click(screen.getByRole("button", { name: /src\/example[.]ts/ }));

    await waitFor(() =>
      expect(mockOpenFileInWorkbench).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          workspaceId: "workspace-1",
          path: "src/example.ts",
          isFileTabsDisabled: true,
        }),
      ),
    );
    expect(onFileOpen).toHaveBeenCalledOnce();
    expect(mockOpenFile).not.toHaveBeenCalled();
    expect(mockRouterPush).not.toHaveBeenCalled();
  });

  it("routes the opener's navigation through the router", async () => {
    settings.fileOpenMode = "sidebar";
    renderPanel(makeMessage());
    fireEvent.click(screen.getByRole("button", { name: /src\/example[.]ts/ }));
    await waitFor(() => expect(mockOpenFileInWorkbench).toHaveBeenCalledOnce());

    mockOpenFileInWorkbench.mock.lastCall?.[0].navigate("/workbench?x=1");

    expect(mockRouterPush).toHaveBeenCalledExactlyOnceWith("/workbench?x=1");
  });

  it("opens the file as a workbench tab in diff mode on GitCompare click", async () => {
    let modeWhenOpening: string | undefined;
    mockOpenFileInWorkbench.mockImplementationOnce(async () => {
      modeWhenOpening = useEditorStore.getState().fileViewModes[VIEW_MODE_KEY];
      return true;
    });
    renderPanel(makeMessage());

    fireEvent.click(screen.getByTitle("Open in git diff"));

    await waitFor(() =>
      expect(mockOpenFileInWorkbench).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          workspaceId: "workspace-1",
          path: "src/example.ts",
          isFileTabsDisabled: true,
        }),
      ),
    );
    expect(modeWhenOpening).toBe("diff");
    expect(mockOpenFile).not.toHaveBeenCalled();
    expect(mockRouterPush).not.toHaveBeenCalled();
  });

  it("reports an error when the diff tab cannot be opened", async () => {
    mockOpenFileInWorkbench.mockResolvedValueOnce(false);
    renderPanel(makeMessage());

    fireEvent.click(screen.getByTitle("Open in git diff"));

    await waitFor(() =>
      expect(mockToastError).toHaveBeenCalledExactlyOnceWith(
        "Could not open file",
      ),
    );
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
