import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { useWorkbenchLspOpenHandler } from "@/components/workbench/use-workbench-lsp-open-handler";
import { SETTINGS_KEYS } from "@/hooks/use-settings";
import { getLspOpenFileHandler } from "@/lib/lsp/client/navigation-registry";
import type { OpenFileInWorkbenchInput } from "@/lib/workbench/open-in-workbench";
import { useWorkbenchStore } from "@/stores/workbench-store";

const { openFileInWorkbenchMock, routerPushMock } = vi.hoisted(() => ({
  openFileInWorkbenchMock: vi.fn<
    (input: OpenFileInWorkbenchInput) => Promise<boolean>
  >(async () => true),
  routerPushMock: vi.fn<(href: string) => void>(),
}));

vi.mock("@/lib/workbench/open-in-workbench", () => ({
  openFileInWorkbench: openFileInWorkbenchMock,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPushMock, replace: vi.fn() }),
}));

const isCurrent = () => true;

function renderOpenHandler(
  workspaceId: string | null,
  settings: Record<string, unknown> = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  queryClient.setQueryData(["settings"], settings);
  return renderHook(() => useWorkbenchLspOpenHandler(workspaceId), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
}

function focusFileTab(path: string, workspaceId = "w1"): void {
  useWorkbenchStore.getState().setFocusedPanel({
    workspaceId,
    panelId: `tab-${path}`,
    params: { kind: "file", workspaceId, path },
  });
}

function filesPageHandler() {
  const handler = getLspOpenFileHandler("files-page");
  if (!handler) throw new Error("no files-page LSP open handler registered");
  return handler;
}

beforeEach(() => {
  useWorkbenchStore.setState(useWorkbenchStore.getInitialState(), true);
  openFileInWorkbenchMock.mockReset().mockResolvedValue(true);
  routerPushMock.mockClear();
});

afterEach(() => {
  cleanup();
});

describe("useWorkbenchLspOpenHandler", () => {
  it("opens a definition's file as a file tab of the workspace", async () => {
    // Given
    renderOpenHandler("w1", { [SETTINGS_KEYS.DISABLE_FILE_TABS]: true });

    // When
    await filesPageHandler()("src/b.ts", isCurrent);

    // Then
    expect(openFileInWorkbenchMock).toHaveBeenCalledExactlyOnceWith({
      workspaceId: "w1",
      path: "src/b.ts",
      isFileTabsDisabled: true,
      shouldCommit: isCurrent,
      navigate: expect.any(Function),
    });
  });

  it("navigates with the router when the opener falls back to a link", async () => {
    // Given
    renderOpenHandler("w1");
    await filesPageHandler()("src/b.ts", isCurrent);
    const [input] = openFileInWorkbenchMock.mock.lastCall ?? [];

    // When
    input?.navigate("/workbench?workspaceId=w1&open=file&path=src%2Fb.ts");

    // Then
    expect(routerPushMock).toHaveBeenCalledExactlyOnceWith(
      "/workbench?workspaceId=w1&open=file&path=src%2Fb.ts",
    );
  });

  it("reports the navigation done once the opened file's tab is focused", async () => {
    // Given
    openFileInWorkbenchMock.mockImplementation(async (input) => {
      focusFileTab(input.path);
      return true;
    });
    renderOpenHandler("w1");

    // When
    const isOpened = await filesPageHandler()("src/b.ts", isCurrent);

    // Then
    expect(isOpened).toBe(true);
  });

  it("reports the navigation unfinished while another file tab is focused", async () => {
    // Given
    focusFileTab("src/a.ts");
    renderOpenHandler("w1");

    // When
    const isOpened = await filesPageHandler()("src/b.ts", isCurrent);

    // Then
    expect(isOpened).toBe(false);
  });

  it("reports the navigation unfinished when another workspace's tab is focused", async () => {
    // Given
    focusFileTab("src/b.ts", "w2");
    renderOpenHandler("w1");

    // When
    const isOpened = await filesPageHandler()("src/b.ts", isCurrent);

    // Then
    expect(isOpened).toBe(false);
  });

  it("opens nothing while no workspace layout is shown", async () => {
    // Given
    renderOpenHandler(null);

    // When
    const isOpened = await filesPageHandler()("src/b.ts", isCurrent);

    // Then
    expect(isOpened).toBe(false);
    expect(openFileInWorkbenchMock).not.toHaveBeenCalled();
  });

  it("unregisters its handler on unmount", () => {
    // Given
    const { unmount } = renderOpenHandler("w1");

    // When
    unmount();

    // Then
    expect(getLspOpenFileHandler("files-page")).toBeUndefined();
  });
});
