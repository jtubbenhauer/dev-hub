import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ChatFileDialog } from "@/components/chat/chat-file-dialog";
import { useChatFileDialogStore } from "@/stores/chat-file-dialog-store";
import { IMAGE_LANGUAGE, PDF_LANGUAGE } from "@/lib/file-preview";
import { downloadTextFile } from "@/lib/download-file";
vi.mock("@/hooks/use-settings", () => ({
  useLspEnabledSetting: () => ({ isLspEnabled: false }),
}));

vi.mock("@/components/editor/editor-switcher", () => ({
  EditorSwitcher: () => <div data-testid="editor-switcher" />,
}));

vi.mock("@/components/editor/pdf-viewer", () => ({
  PdfViewer: () => <div data-testid="pdf-viewer" />,
}));

vi.mock("@/lib/download-file", () => ({
  downloadTextFile: vi.fn(),
}));

function renderDialog() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ChatFileDialog />
    </QueryClientProvider>,
  );
}

describe("ChatFileDialog download button", () => {
  beforeEach(() => {
    vi.mocked(downloadTextFile).mockClear();
    useChatFileDialogStore.getState().reset();
  });

  it("downloads the current editor content for text files", async () => {
    useChatFileDialogStore.setState({
      isOpen: true,
      isLoading: false,
      file: {
        path: "src/lib/example.ts",
        instanceId: 1,
        content: "edited content",
        language: "typescript",
        workspaceId: "ws-1",
      },
      originalContent: "original content",
    });

    renderDialog();
    await userEvent.click(
      screen.getByRole("button", { name: "Download file" }),
    );

    expect(downloadTextFile).toHaveBeenCalledWith(
      "example.ts",
      "edited content",
    );
  });

  it("links PDFs to the raw file endpoint", () => {
    useChatFileDialogStore.setState({
      isOpen: true,
      isLoading: false,
      file: {
        path: "docs/report.pdf",
        instanceId: 2,
        content: "",
        language: PDF_LANGUAGE,
        workspaceId: "ws-1",
      },
      originalContent: "",
    });

    renderDialog();
    const downloadLink = screen.getByRole("link", { name: "Download file" });

    expect(downloadLink).toHaveAttribute("download", "report.pdf");
    expect(downloadLink).toHaveAttribute(
      "href",
      "/api/files/raw?workspaceId=ws-1&path=docs%2Freport.pdf",
    );
  });

  it("offers a download for files the editor cannot display", () => {
    useChatFileDialogStore.setState({
      isOpen: true,
      isLoading: false,
      file: {
        path: "build/app.zip",
        instanceId: 4,
        content: "",
        language: "plaintext",
        workspaceId: "ws-1",
      },
      originalContent: "",
      unsupportedReason: "This file can't be displayed in the editor.",
    });

    renderDialog();

    expect(
      screen.getByText("This file can't be displayed in the editor."),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("editor-switcher")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Save file" }),
    ).not.toBeInTheDocument();
    const expectedUrl =
      "/api/files/raw?workspaceId=ws-1&path=build%2Fapp.zip&download=1";
    for (const name of ["Download", "Download file"]) {
      const downloadLink = screen.getByRole("link", { name });
      expect(downloadLink).toHaveAttribute("href", expectedUrl);
      expect(downloadLink).toHaveAttribute("download", "app.zip");
    }
  });

  it("previews images instead of opening the editor", () => {
    useChatFileDialogStore.setState({
      isOpen: true,
      isLoading: false,
      file: {
        path: "assets/logo.png",
        instanceId: 3,
        content: "",
        language: IMAGE_LANGUAGE,
        workspaceId: "ws-1",
      },
      originalContent: "",
    });

    renderDialog();

    expect(screen.getByRole("img", { name: "logo.png" })).toHaveAttribute(
      "src",
      "/api/files/raw?workspaceId=ws-1&path=assets%2Flogo.png",
    );
    expect(screen.queryByTestId("editor-switcher")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Save file" }),
    ).not.toBeInTheDocument();
    const downloadLink = screen.getByRole("link", { name: "Download file" });
    expect(downloadLink).toHaveAttribute("download", "logo.png");
    expect(downloadLink).toHaveAttribute(
      "href",
      "/api/files/raw?workspaceId=ws-1&path=assets%2Flogo.png",
    );
  });
});
