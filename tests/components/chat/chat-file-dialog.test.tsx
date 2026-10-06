import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ChatFileDialog } from "@/components/chat/chat-file-dialog";
import { useChatFileDialogStore } from "@/stores/chat-file-dialog-store";
import { IMAGE_LANGUAGE, PDF_LANGUAGE } from "@/lib/file-preview";
import { downloadTextFile } from "@/lib/download-file";

vi.mock("@/components/editor/editor-switcher", () => ({
  EditorSwitcher: () => <div data-testid="editor-switcher" />,
}));

vi.mock("@/components/editor/pdf-viewer", () => ({
  PdfViewer: () => <div data-testid="pdf-viewer" />,
}));

vi.mock("@/lib/download-file", () => ({
  downloadTextFile: vi.fn(),
}));

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
        content: "edited content",
        language: "typescript",
        workspaceId: "ws-1",
      },
      originalContent: "original content",
    });

    render(<ChatFileDialog />);
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
        content: "",
        language: PDF_LANGUAGE,
        workspaceId: "ws-1",
      },
      originalContent: "",
    });

    render(<ChatFileDialog />);
    const downloadLink = screen.getByRole("link", { name: "Download file" });

    expect(downloadLink).toHaveAttribute("download", "report.pdf");
    expect(downloadLink).toHaveAttribute(
      "href",
      "/api/files/raw?workspaceId=ws-1&path=docs%2Freport.pdf",
    );
  });

  it("previews images instead of opening the editor", () => {
    useChatFileDialogStore.setState({
      isOpen: true,
      isLoading: false,
      file: {
        path: "assets/logo.png",
        content: "",
        language: IMAGE_LANGUAGE,
        workspaceId: "ws-1",
      },
      originalContent: "",
    });

    render(<ChatFileDialog />);

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
