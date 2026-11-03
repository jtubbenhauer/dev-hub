import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { ExportSessionDialog } from "@/components/chat/export-session-dialog";
import type { OpenFileInWorkbenchInput } from "@/lib/workbench/open-in-workbench";
import { WORKBENCH_PATH } from "@/lib/workbench/workbench-href";
import { useEditorStore } from "@/stores/editor-store";

const hoisted = vi.hoisted(() => ({
  routerPush: vi.fn<(href: string) => void>(),
  openFileInWorkbench: vi.fn<
    (input: OpenFileInWorkbenchInput) => Promise<boolean>
  >(async () => true),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: hoisted.routerPush }),
}));
vi.mock("@/hooks/use-settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-settings")>()),
  useFileTabsSetting: () => ({ isFileTabsDisabled: true, isLoading: false }),
}));
vi.mock("@/lib/workbench/open-in-workbench", () => ({
  openFileInWorkbench: hoisted.openFileInWorkbench,
}));

const fetchMock = vi.fn<typeof fetch>();

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function renderDialog() {
  const onClose = vi.fn();
  render(
    <ExportSessionDialog
      workspaceId="ws-1"
      sessionId="ses_abcd1234"
      defaultThinking={false}
      defaultToolDetails={true}
      onClose={onClose}
    />,
  );
  return { onClose };
}

function sentBody(): unknown {
  const [, init] = fetchMock.mock.calls[0] ?? [];
  return JSON.parse(String(init?.body));
}

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.openFileInWorkbench.mockResolvedValue(true);
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  useEditorStore.getState().closeAllFiles();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ExportSessionDialog", () => {
  it("starts from the TUI defaults and the chat's display toggles", () => {
    renderDialog();

    expect(screen.getByLabelText("Filename")).toHaveValue(
      "session-ses_abcd.md",
    );
    expect(
      screen.getByRole("checkbox", { name: "Include thinking" }),
    ).not.toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "Include tool details" }),
    ).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "Include assistant metadata" }),
    ).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "Open without saving" }),
    ).not.toBeChecked();
  });

  it("sends the chosen filename and options to the export route", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(jsonResponse({ path: "notes/build.md" }));
    renderDialog();

    await user.clear(screen.getByLabelText("Filename"));
    await user.type(screen.getByLabelText("Filename"), "notes/build.md");
    await user.click(
      screen.getByRole("checkbox", { name: "Include thinking" }),
    );
    await user.click(screen.getByRole("button", { name: "Export" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/sessions/export");
    expect(sentBody()).toEqual({
      workspaceId: "ws-1",
      sessionId: "ses_abcd1234",
      filename: "notes/build.md",
      thinking: true,
      toolDetails: true,
      assistantMetadata: true,
      openWithoutSaving: false,
    });
  });

  it("closes and opens the saved transcript as a workbench tab", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(jsonResponse({ path: "session-ses_abcd.md" }));
    const { onClose } = renderDialog();

    await user.click(screen.getByRole("button", { name: "Export" }));

    await waitFor(() =>
      expect(hoisted.openFileInWorkbench).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          workspaceId: "ws-1",
          path: "session-ses_abcd.md",
          isFileTabsDisabled: true,
        }),
      ),
    );
    expect(onClose).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith(
      "Session exported to session-ses_abcd.md",
    );
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("routes the opener's navigation through the router", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(jsonResponse({ path: "session-ses_abcd.md" }));
    renderDialog();
    await user.click(screen.getByRole("button", { name: "Export" }));
    await waitFor(() =>
      expect(hoisted.openFileInWorkbench).toHaveBeenCalledOnce(),
    );

    hoisted.openFileInWorkbench.mock.lastCall?.[0].navigate(
      `${WORKBENCH_PATH}?x=1`,
    );

    expect(hoisted.routerPush).toHaveBeenCalledExactlyOnceWith(
      `${WORKBENCH_PATH}?x=1`,
    );
  });

  it("reloads an open buffer of the transcript before opening its tab", async () => {
    const user = userEvent.setup();
    useEditorStore.getState().openFile({
      workspaceId: "ws-1",
      path: "session-ses_abcd.md",
      name: "session-ses_abcd.md",
      content: "old export",
      language: "markdown",
      isDirty: false,
      originalContent: "old export",
    });
    fetchMock.mockImplementation(async (url) =>
      String(url).startsWith("/api/files/content")
        ? jsonResponse({ content: "new export", language: "markdown" })
        : jsonResponse({ path: "session-ses_abcd.md" }),
    );
    let contentWhenOpening: string | undefined;
    hoisted.openFileInWorkbench.mockImplementationOnce(async () => {
      contentWhenOpening = useEditorStore.getState().openFiles[0]?.content;
      return true;
    });
    renderDialog();

    await user.click(screen.getByRole("button", { name: "Export" }));

    await waitFor(() =>
      expect(hoisted.openFileInWorkbench).toHaveBeenCalledOnce(),
    );
    expect(contentWhenOpening).toBe("new export");
  });

  it("reports when the saved transcript cannot be opened", async () => {
    const user = userEvent.setup();
    hoisted.openFileInWorkbench.mockResolvedValueOnce(false);
    fetchMock.mockResolvedValue(jsonResponse({ path: "session-ses_abcd.md" }));
    renderDialog();

    await user.click(screen.getByRole("button", { name: "Export" }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledExactlyOnceWith(
        "Could not open file",
      ),
    );
  });

  it("shows a read-only preview instead of saving when asked not to save", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      jsonResponse({ markdown: "# Fix the build\n\n## User\n\nHello" }),
    );
    const { onClose } = renderDialog();

    await user.click(
      screen.getByRole("checkbox", { name: "Open without saving" }),
    );
    await user.click(screen.getByRole("button", { name: "Export" }));

    const preview = await screen.findByTestId("export-session-preview");
    expect(preview).toHaveTextContent("## User");
    expect(hoisted.openFileInWorkbench).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("stays open and reports the server's reason when export fails", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      jsonResponse(
        { error: "Failed to load session", detail: "GET responded 500" },
        502,
      ),
    );
    const { onClose } = renderDialog();

    await user.click(screen.getByRole("button", { name: "Export" }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Failed to export session", {
        description: "GET responded 500",
      }),
    );
    expect(onClose).not.toHaveBeenCalled();
  });
});
