import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { toast } from "sonner";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ChatFileDialog } from "@/components/chat/chat-file-dialog";
import { useChatFileDialogStore as store } from "@/stores/chat-file-dialog-store";

let isLspEnabled = false;
vi.mock("@/hooks/use-settings", () => ({
  useLspEnabledSetting: () => ({ isLspEnabled }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/components/editor/editor-switcher", () => ({
  EditorSwitcher: () => <div />,
}));

let queryClient = new QueryClient();

function renderDialog() {
  return render(
    <QueryClientProvider client={queryClient}>
      <ChatFileDialog />
    </QueryClientProvider>,
  );
}

function getGitStatusInvalidations() {
  return vi
    .mocked(queryClient.invalidateQueries)
    .mock.calls.filter(([filters]) => filters?.queryKey?.[0] === "git-status");
}

beforeEach(() => {
  vi.clearAllMocks();
  queryClient = new QueryClient();
  vi.spyOn(queryClient, "invalidateQueries");
  isLspEnabled = false;
  store.setState({
    isOpen: true,
    isLoading: false,
    originalContent: "base",
    file: {
      workspaceId: "A",
      path: "a.ts",
      content: "v1",
      language: "typescript",
      instanceId: 1,
    },
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  store.getState().reset();
});

describe("dialog snapshot saves", () => {
  it.each([false, true])(
    "preserves typing during PUT with LSP %s",
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
      renderDialog();
      fireEvent.click(screen.getByRole("button", { name: "Save file" }));
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
      act(() => store.getState().setContent("v2"));
      await act(async () => {
        finish(Response.json({ success: true }));
      });
      expect(store.getState().originalContent).toBe("v1");
      expect(store.getState().file?.content).toBe("v2");
      expect(screen.getByText("Modified")).toBeInTheDocument();
      expect(toast.success).toHaveBeenCalledWith("File saved");
      expect(getGitStatusInvalidations()).toEqual([
        [{ queryKey: ["git-status", "A"] }],
      ]);
    },
  );
  it("does not acknowledge or toast success after reopening", async () => {
    let finish: (response: Response) => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            finish = resolve;
          }),
      ),
    );
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Save file" }));
    act(() =>
      store.setState({
        originalContent: "reopened",
        file: {
          workspaceId: "B",
          path: "a.ts",
          content: "reopened",
          language: "typescript",
          instanceId: 2,
        },
      }),
    );
    await act(async () => {
      finish(Response.json({ success: true }));
    });
    expect(store.getState().originalContent).toBe("reopened");
    expect(toast.success).not.toHaveBeenCalled();
    expect(getGitStatusInvalidations()).toEqual([]);
  });
  it("shows server errors without acknowledging", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { error: "disk changed", code: "STALE_BASE" },
          { status: 409 },
        ),
      ),
    );
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Save file" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("disk changed"),
    );
    expect(store.getState().originalContent).toBe("base");
    expect(toast.success).not.toHaveBeenCalled();
    expect(getGitStatusInvalidations()).toEqual([]);
  });
});
