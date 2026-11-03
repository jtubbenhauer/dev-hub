import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { FilePathCode } from "@/components/chat/file-path-code";
import type { ChatFileOpenMode } from "@/hooks/use-settings";
import { createWorkbenchHref } from "@/lib/workbench/workbench-href";
import { useChatFileDialogStore } from "@/stores/chat-file-dialog-store";
import { useEditorStore } from "@/stores/editor-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import {
  mountFakeWorkbench,
  type FakeWorkbenchController,
} from "@/tests/helpers/fake-workbench-controller";

const hoisted = vi.hoisted(() => ({
  routerPush: vi.fn<(href: string) => void>(),
  fileOpenMode: "sidebar" as ChatFileOpenMode,
  isMobile: false,
}));

vi.mock("@/hooks/use-settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-settings")>()),
  useChatFileOpenSetting: () => ({
    fileOpenMode: hoisted.fileOpenMode,
    isLoading: false,
  }),
  useFileTabsSetting: () => ({ isFileTabsDisabled: false, isLoading: false }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: hoisted.routerPush }),
}));

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => hoisted.isMobile,
}));

const FILE_PATH = "src/utils.ts";
const FILE_HREF = createWorkbenchHref({
  open: "file",
  workspaceId: "ws-1",
  path: FILE_PATH,
});
const fetchMock = vi.fn<typeof fetch>();
let unmountWorkbench: (() => void) | null = null;

function mountWorkbench(): FakeWorkbenchController {
  const workbench = mountFakeWorkbench("ws-1");
  unmountWorkbench = workbench.unmount;
  return workbench.controller;
}

function okResponse(content: string) {
  return Response.json({ content, language: "typescript" });
}

function clickPath(text: string) {
  render(<FilePathCode text={text}>{text}</FilePathCode>);
  fireEvent.click(screen.getByRole("link"));
}

// One macrotask turn lets the opener's fetch/load promise chain settle.
async function flushPromises() {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.fileOpenMode = "sidebar";
  hoisted.isMobile = false;
  fetchMock.mockReset().mockImplementation(async () => okResponse("const x"));
  vi.stubGlobal("fetch", fetchMock);
  useWorkspaceStore.setState({ activeWorkspaceId: "ws-1" });
  useEditorStore.getState().closeAllFiles();
  useChatFileDialogStore.getState().reset();
});

afterEach(() => {
  cleanup();
  unmountWorkbench?.();
  unmountWorkbench = null;
  vi.unstubAllGlobals();
});

describe("FilePathCode — file click with the workbench mounted", () => {
  it.each([false, true])(
    "loads the file and opens one workbench file tab (mobile=%s)",
    async (isMobile) => {
      // Given
      hoisted.isMobile = isMobile;
      const controller = mountWorkbench();

      // When
      clickPath(FILE_PATH);

      // Then
      await waitFor(() =>
        expect(controller.openTab).toHaveBeenCalledExactlyOnceWith({
          kind: "file",
          workspaceId: "ws-1",
          path: FILE_PATH,
        }),
      );
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("workspaceId=ws-1"),
        expect.anything(),
      );
      expect(useEditorStore.getState().openFiles).toEqual([
        expect.objectContaining({ path: FILE_PATH, content: "const x" }),
      ]);
      expect(hoisted.routerPush).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["a 404", async () => new Response(null, { status: 404 })],
    [
      "a network error",
      async (): Promise<Response> => {
        throw new TypeError("network error");
      },
    ],
  ])("opens no tab and stays on the page after %s", async (_label, respond) => {
    // Given
    fetchMock.mockImplementation(respond);
    const controller = mountWorkbench();

    // When
    clickPath(FILE_PATH);

    // Then
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(controller.openTab).not.toHaveBeenCalled();
    expect(hoisted.routerPush).not.toHaveBeenCalled();
  });
});

describe("FilePathCode — file click without the workbench", () => {
  it.each([false, true])(
    "navigates to the workbench file intent without reading the file (mobile=%s)",
    (isMobile) => {
      // Given
      hoisted.isMobile = isMobile;

      // When
      clickPath(FILE_PATH);

      // Then
      expect(hoisted.routerPush).toHaveBeenCalledExactlyOnceWith(FILE_HREF);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
});

describe("FilePathCode — dialog mode", () => {
  it.each([false, true])(
    "opens the file in the chat dialog, not a tab (mobile=%s)",
    async (isMobile) => {
      // Given
      hoisted.fileOpenMode = "dialog";
      hoisted.isMobile = isMobile;
      const controller = mountWorkbench();

      // When
      clickPath(FILE_PATH);

      // Then
      await waitFor(() =>
        expect(useChatFileDialogStore.getState().file).toMatchObject({
          workspaceId: "ws-1",
          path: FILE_PATH,
          content: "const x",
        }),
      );
      expect(useChatFileDialogStore.getState().isOpen).toBe(true);
      expect(controller.openTab).not.toHaveBeenCalled();
      expect(hoisted.routerPush).not.toHaveBeenCalled();
    },
  );

  it("falls back to the workbench file intent when the dialog cannot read the file", async () => {
    // Given
    hoisted.fileOpenMode = "dialog";
    fetchMock.mockImplementation(
      async () => new Response(null, { status: 404 }),
    );

    // When
    clickPath(FILE_PATH);

    // Then
    await waitFor(() =>
      expect(hoisted.routerPush).toHaveBeenCalledExactlyOnceWith(FILE_HREF),
    );
    expect(useChatFileDialogStore.getState().isOpen).toBe(false);
  });
});

describe("FilePathCode — folder click", () => {
  it("reveals the folder in the mounted workbench", () => {
    // Given
    const controller = mountWorkbench();

    // When
    clickPath("src/components/chat");

    // Then
    expect(controller.revealFolder).toHaveBeenCalledExactlyOnceWith(
      "src/components/chat",
    );
    expect(hoisted.routerPush).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("navigates to the workbench folder intent without the workbench", () => {
    // When
    clickPath("src/components/chat");

    // Then
    expect(hoisted.routerPush).toHaveBeenCalledExactlyOnceWith(
      createWorkbenchHref({
        open: "folder",
        workspaceId: "ws-1",
        path: "src/components/chat",
      }),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
