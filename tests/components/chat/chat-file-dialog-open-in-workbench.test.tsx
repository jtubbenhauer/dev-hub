import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ChatFileDialog } from "@/components/chat/chat-file-dialog";
import type { OpenFileInWorkbenchInput } from "@/lib/workbench/open-in-workbench";
import { createWorkbenchHref } from "@/lib/workbench/workbench-href";
import { useChatFileDialogStore } from "@/stores/chat-file-dialog-store";

const hoisted = vi.hoisted(() => ({
  routerPush: vi.fn<(href: string) => void>(),
  openFileInWorkbench: vi.fn<
    (input: OpenFileInWorkbenchInput) => Promise<boolean>
  >(async () => true),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: hoisted.routerPush }),
}));
vi.mock("@/hooks/use-settings", () => ({
  useLspEnabledSetting: () => ({ isLspEnabled: false }),
  useFileTabsSetting: () => ({ isFileTabsDisabled: true, isLoading: false }),
}));
vi.mock("@/components/editor/editor-switcher", () => ({
  EditorSwitcher: () => <div data-testid="editor-switcher" />,
}));
vi.mock("@/lib/workbench/open-in-workbench", () => ({
  openFileInWorkbench: hoisted.openFileInWorkbench,
}));

const FILE_PATH = "src/lib/example.ts";

function openDialogWith(content: string) {
  useChatFileDialogStore.setState({
    isOpen: true,
    isLoading: false,
    file: {
      path: FILE_PATH,
      instanceId: 1,
      content,
      language: "typescript",
      workspaceId: "ws-1",
    },
    originalContent: "saved content",
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ChatFileDialog />
    </QueryClientProvider>,
  );
  return screen.getByRole("link", { name: "Open in full editor" });
}

beforeEach(() => {
  vi.clearAllMocks();
  useChatFileDialogStore.getState().reset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ChatFileDialog full editor link", () => {
  it("links to the workbench file intent of the dialog's file", () => {
    // When
    const link = openDialogWith("saved content");

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

  it("opens the file as a workbench tab and closes the dialog", () => {
    // Given
    const link = openDialogWith("saved content");

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
    expect(useChatFileDialogStore.getState().isOpen).toBe(false);
    expect(hoisted.routerPush).not.toHaveBeenCalled();
  });

  it("routes the opener's navigation through the router", () => {
    // Given
    fireEvent.click(openDialogWith("saved content"));

    // When
    hoisted.openFileInWorkbench.mock.lastCall?.[0].navigate("/workbench?x=1");

    // Then
    expect(hoisted.routerPush).toHaveBeenCalledExactlyOnceWith(
      "/workbench?x=1",
    );
  });

  it("keeps unsaved dialog edits when the discard prompt is declined", () => {
    // Given
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const link = openDialogWith("edited content");

    // When
    fireEvent.click(link);

    // Then
    expect(hoisted.openFileInWorkbench).not.toHaveBeenCalled();
    expect(useChatFileDialogStore.getState().isOpen).toBe(true);
    expect(useChatFileDialogStore.getState().file?.content).toBe(
      "edited content",
    );
  });

  it("opens the tab after the discard prompt is accepted", () => {
    // Given
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const link = openDialogWith("edited content");

    // When
    fireEvent.click(link);

    // Then
    expect(confirm).toHaveBeenCalledOnce();
    expect(hoisted.openFileInWorkbench).toHaveBeenCalledOnce();
    expect(useChatFileDialogStore.getState().isOpen).toBe(false);
  });
});
