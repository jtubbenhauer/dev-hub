import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { ExportSessionDialog } from "@/components/chat/export-session-dialog";
import { openFileInSidePanel } from "@/lib/side-panel-open-file";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/side-panel-open-file", () => ({
  openFileInSidePanel: vi.fn(async () => undefined),
}));

const fetchMock = vi.fn();

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
  vi.stubGlobal("fetch", fetchMock);
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

  it("closes and opens the saved transcript in the side panel", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(jsonResponse({ path: "session-ses_abcd.md" }));
    const { onClose } = renderDialog();

    await user.click(screen.getByRole("button", { name: "Export" }));

    await waitFor(() =>
      expect(openFileInSidePanel).toHaveBeenCalledWith(
        "ws-1",
        "session-ses_abcd.md",
        expect.any(Function),
      ),
    );
    expect(onClose).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith(
      "Session exported to session-ses_abcd.md",
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
    expect(openFileInSidePanel).not.toHaveBeenCalled();
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
