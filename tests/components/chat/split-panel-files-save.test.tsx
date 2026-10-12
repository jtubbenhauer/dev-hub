import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { SplitPanelFiles } from "@/components/chat/split-panel-files";
import { useSidePanelStore as store } from "@/stores/side-panel-store";

const lintFile = vi.fn();
let isLspEnabled = false;
vi.mock("@/hooks/use-settings", () => ({
  useLspEnabledSetting: () => ({ isLspEnabled }),
  useChatSidebarTabsOpenSetting: () => ({ sidebarTabsOpenMode: "sidebar" }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), warning: vi.fn() } }));
vi.mock("next/dynamic", () => ({
  default: () =>
    function Editor(props: { isLspEligible: boolean }) {
      return (
        <div data-testid="editor" data-eligible={String(props.isLspEligible)} />
      );
    },
}));
vi.mock("@/components/chat/use-file-view-mode", () => ({
  useFileViewMode: () => ({
    mode: "editor",
    canDiff: false,
    repoRelativeKey: "a.ts",
    setMode: vi.fn(),
  }),
}));
vi.mock("@/hooks/use-diagnostics", () => ({
  useLintOnSave: () => ({ lintFile }),
}));
vi.mock("@/hooks/use-file-comments", () => ({
  useFileComments: () => ({ data: [] }),
  useResolveFileComment: () => ({ mutate: vi.fn() }),
  useDeleteFileComment: () => ({ mutate: vi.fn() }),
  useUpdateFileComment: () => ({ mutate: vi.fn() }),
}));
vi.mock("@/components/editor/file-tree", () => ({ FileTree: () => <div /> }));
vi.mock("@/components/chat/split-panel-file-tabs", () => ({
  SplitPanelFileTabs: () => <div />,
}));

beforeEach(() => {
  vi.clearAllMocks();
  isLspEnabled = false;
  store.setState({
    openFiles: [],
    activeFilePath: null,
    workspaceFileStates: {},
    isFilePickerOpen: false,
    isLoading: false,
    error: null,
  });
  store.getState().openFileInTab("a.ts", "base", "typescript", "A");
  store.getState().updateFileContent("a.ts", "v1");
});
afterEach(() => vi.unstubAllGlobals());

function renderPanel(workspaceId = "A") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const panel = (id: string) => (
    <QueryClientProvider client={client}>
      <SplitPanelFiles workspaceId={id} workspacePath="/workspace" />
    </QueryClientProvider>
  );
  const view = render(panel(workspaceId));
  return { invalidate, switchWorkspace: () => view.rerender(panel("B")) };
}

describe("split-panel snapshot saves", () => {
  it.each([false, true])(
    "keeps typing dirty during save, LSP=%s",
    async (enabled) => {
      isLspEnabled = enabled;
      let finish: (response: Response) => void = () => {};
      const fetchMock = vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            finish = resolve;
          }),
      );
      vi.stubGlobal("fetch", fetchMock);
      const { invalidate } = renderPanel();
      fireEvent.click(screen.getByTestId("split-panel-save"));
      await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/files/content",
        expect.objectContaining({
          body: JSON.stringify({
            workspaceId: "A",
            path: "a.ts",
            content: "v1",
            ...(enabled ? { baseContent: "base" } : {}),
          }),
        }),
      );
      act(() => store.getState().updateFileContent("a.ts", "v2"));
      await act(async () => {
        finish(Response.json({ success: true }));
      });
      await waitFor(() =>
        expect(store.getState().openFiles[0].originalContent).toBe("v1"),
      );
      expect(store.getState().openFiles[0]).toMatchObject({
        content: "v2",
        isDirty: true,
      });
      expect(lintFile).toHaveBeenCalledOnce();
      expect(invalidate).toHaveBeenCalledTimes(3);
    },
  );
  it("saves foreign tabs into their workspace without LSP or follow-ups", async () => {
    const fetchMock = vi.fn(async () => Response.json({ success: true }));
    vi.stubGlobal("fetch", fetchMock);
    const { invalidate } = renderPanel("B");
    expect(screen.getByTestId("editor")).toHaveAttribute(
      "data-eligible",
      "false",
    );
    fireEvent.click(screen.getByTestId("split-panel-save"));
    await waitFor(() =>
      expect(store.getState().openFiles[0].isDirty).toBe(false),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/files/content",
      expect.objectContaining({
        body: JSON.stringify({ workspaceId: "A", path: "a.ts", content: "v1" }),
      }),
    );
    expect(lintFile).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
  });
  it("suppresses completion after a workspace switch", async () => {
    let finish: (response: Response) => void = () => {};
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { invalidate, switchWorkspace } = renderPanel();
    fireEvent.click(screen.getByTestId("split-panel-save"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    switchWorkspace();
    await act(async () => {
      finish(Response.json({ success: true }));
    });
    expect(lintFile).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
  });
  it("shows a stale-base error without acknowledging", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ error: "disk changed" }, { status: 409 }),
      ),
    );
    const { invalidate } = renderPanel();
    fireEvent.click(screen.getByTestId("split-panel-save"));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("disk changed"),
    );
    expect(store.getState().openFiles[0]).toMatchObject({
      originalContent: "base",
      isDirty: true,
    });
    expect(invalidate).not.toHaveBeenCalled();
  });
});
