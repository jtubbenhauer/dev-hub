import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FilePathCode } from "@/components/chat/file-path-code";
import type { ChatFileOpenMode } from "@/hooks/use-settings";
import type { OpenFileInWorkbenchInput } from "@/lib/workbench/open-in-workbench";
import {
  createWorkbenchHref,
  WORKBENCH_PATH,
} from "@/lib/workbench/workbench-href";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { mountFakeWorkbench } from "@/tests/helpers/fake-workbench-controller";

const hoisted = vi.hoisted(() => ({
  routerPush: vi.fn<(href: string) => void>(),
  openFileInWorkbench: vi.fn<
    (input: OpenFileInWorkbenchInput) => Promise<boolean>
  >(async () => true),
  openChatFileDialog:
    vi.fn<
      (workspaceId: string, path: string, fallback: () => void) => Promise<void>
    >(),
  settings: {
    fileOpenMode: "sidebar" as ChatFileOpenMode,
    isFileTabsDisabled: true,
    isMobile: false,
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: hoisted.routerPush }),
}));

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => hoisted.settings.isMobile,
}));

vi.mock("@/hooks/use-settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-settings")>()),
  useChatFileOpenSetting: () => ({
    fileOpenMode: hoisted.settings.fileOpenMode,
    isLoading: false,
  }),
  useFileTabsSetting: () => ({
    isFileTabsDisabled: hoisted.settings.isFileTabsDisabled,
    isLoading: false,
  }),
}));

vi.mock("@/lib/workbench/open-in-workbench", () => ({
  openFileInWorkbench: hoisted.openFileInWorkbench,
}));

vi.mock("@/stores/chat-file-dialog-store", () => ({
  useChatFileDialogStore: {
    getState: () => ({ openFile: hoisted.openChatFileDialog }),
  },
}));

const FILE_PATH = "src/utils.ts";
const FOLDER_PATH = "src/components/chat";
const unmounts: (() => void)[] = [];

function mountWorkbenchFor(workspaceId: string) {
  const workbench = mountFakeWorkbench(workspaceId);
  unmounts.push(workbench.unmount);
  return workbench.controller;
}

function renderPath(text: string) {
  render(<FilePathCode text={text}>{text}</FilePathCode>);
  return screen.getByRole("link", { name: text });
}

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.settings.fileOpenMode = "sidebar";
  hoisted.settings.isFileTabsDisabled = true;
  hoisted.settings.isMobile = false;
  useWorkspaceStore.setState({ activeWorkspaceId: "ws-1" });
});

afterEach(() => {
  cleanup();
  for (const unmount of unmounts.splice(0)) unmount();
});

describe("FilePathCode open mode", () => {
  it("opens a file as a workbench tab in sidebar mode", () => {
    // Given
    const link = renderPath(FILE_PATH);

    // When
    fireEvent.click(link);

    // Then
    expect(hoisted.openFileInWorkbench).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        workspaceId: "ws-1",
        path: FILE_PATH,
        isFileTabsDisabled: true,
      }),
    );
    expect(hoisted.openChatFileDialog).not.toHaveBeenCalled();
    expect(hoisted.routerPush).not.toHaveBeenCalled();
  });

  it("opens a file as a workbench tab on mobile instead of navigating", () => {
    // Given
    hoisted.settings.isMobile = true;
    const link = renderPath(FILE_PATH);

    // When
    fireEvent.click(link);

    // Then
    expect(hoisted.openFileInWorkbench).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ workspaceId: "ws-1", path: FILE_PATH }),
    );
    expect(hoisted.routerPush).not.toHaveBeenCalled();
  });

  it("routes the opener's navigation through the router", () => {
    // Given
    fireEvent.click(renderPath(FILE_PATH));
    const input = hoisted.openFileInWorkbench.mock.lastCall?.[0];

    // When
    input?.navigate(`${WORKBENCH_PATH}?open=file&path=x`);

    // Then
    expect(hoisted.routerPush).toHaveBeenCalledWith(
      `${WORKBENCH_PATH}?open=file&path=x`,
    );
  });

  it("opens the chat file dialog in dialog mode", () => {
    // Given
    hoisted.settings.fileOpenMode = "dialog";
    const link = renderPath(FILE_PATH);

    // When
    fireEvent.click(link);

    // Then
    expect(hoisted.openChatFileDialog).toHaveBeenCalledExactlyOnceWith(
      "ws-1",
      FILE_PATH,
      expect.any(Function),
    );
    expect(hoisted.openFileInWorkbench).not.toHaveBeenCalled();
  });

  it("falls back to the workbench file intent when the dialog cannot open the file", () => {
    // Given
    hoisted.settings.fileOpenMode = "dialog";
    fireEvent.click(renderPath(FILE_PATH));
    const fallback = hoisted.openChatFileDialog.mock.lastCall?.[2];

    // When
    fallback?.();

    // Then
    expect(hoisted.routerPush).toHaveBeenCalledExactlyOnceWith(
      createWorkbenchHref({
        open: "file",
        workspaceId: "ws-1",
        path: FILE_PATH,
      }),
    );
  });

  it("navigates to the file intent when no workspace is active", () => {
    // Given
    useWorkspaceStore.setState({ activeWorkspaceId: null });
    const link = renderPath(FILE_PATH);

    // When
    fireEvent.click(link);

    // Then
    expect(hoisted.routerPush).toHaveBeenCalledExactlyOnceWith(
      createWorkbenchHref({ open: "file", workspaceId: null, path: FILE_PATH }),
    );
    expect(hoisted.openFileInWorkbench).not.toHaveBeenCalled();
  });

  it("reveals a folder in the mounted workbench of the active workspace", () => {
    // Given
    const controller = mountWorkbenchFor("ws-1");
    const link = renderPath(FOLDER_PATH);

    // When
    fireEvent.click(link);

    // Then
    expect(controller.revealFolder).toHaveBeenCalledExactlyOnceWith(
      FOLDER_PATH,
    );
    expect(hoisted.routerPush).not.toHaveBeenCalled();
    expect(hoisted.openFileInWorkbench).not.toHaveBeenCalled();
  });

  it("navigates to the folder intent when the workbench is not mounted", () => {
    // Given
    const link = renderPath(FOLDER_PATH);

    // When
    fireEvent.click(link);

    // Then
    expect(hoisted.routerPush).toHaveBeenCalledExactlyOnceWith(
      createWorkbenchHref({
        open: "folder",
        workspaceId: "ws-1",
        path: FOLDER_PATH,
      }),
    );
  });

  it("navigates to the folder intent when the workbench shows another workspace", () => {
    // Given
    const controller = mountWorkbenchFor("ws-2");
    const link = renderPath(FOLDER_PATH);

    // When
    fireEvent.click(link);

    // Then
    expect(controller.revealFolder).not.toHaveBeenCalled();
    expect(hoisted.routerPush).toHaveBeenCalledExactlyOnceWith(
      createWorkbenchHref({
        open: "folder",
        workspaceId: "ws-1",
        path: FOLDER_PATH,
      }),
    );
  });

  it("reveals folders even in dialog mode", () => {
    // Given
    hoisted.settings.fileOpenMode = "dialog";
    const controller = mountWorkbenchFor("ws-1");
    const link = renderPath(FOLDER_PATH);

    // When
    fireEvent.click(link);

    // Then
    expect(controller.revealFolder).toHaveBeenCalledExactlyOnceWith(
      FOLDER_PATH,
    );
    expect(hoisted.openChatFileDialog).not.toHaveBeenCalled();
  });
});

describe("FilePathCode href", () => {
  it("links a file to the workbench file intent", () => {
    // When
    const link = renderPath(FILE_PATH);

    // Then
    expect(link).toHaveAttribute(
      "href",
      createWorkbenchHref({
        open: "file",
        workspaceId: "ws-1",
        path: FILE_PATH,
      }),
    );
  });

  it("links a folder to the workbench folder intent with a clean path", () => {
    // When
    const link = renderPath(`./${FOLDER_PATH}/`);

    // Then
    expect(link).toHaveAttribute(
      "href",
      createWorkbenchHref({
        open: "folder",
        workspaceId: "ws-1",
        path: FOLDER_PATH,
      }),
    );
  });
});
