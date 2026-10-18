import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { FileViewer } from "@/components/editor/file-viewer";
import {
  BINARY_FILE_LANGUAGE,
  IMAGE_LANGUAGE,
  LARGE_FILE_LANGUAGE,
  PDF_LANGUAGE,
} from "@/lib/file-preview";

vi.mock("@/components/editor/editor-switcher", () => ({
  EditorSwitcher: (props: { language: string; content: string }) => (
    <div
      data-testid="editor-switcher"
      data-language={props.language}
      data-content={props.content}
    />
  ),
}));

function renderViewer(filePath: string, language: string, content = "") {
  return render(
    <FileViewer
      workspaceId="ws-1"
      filePath={filePath}
      language={language}
      content={content}
      onChange={vi.fn()}
    />,
  );
}

describe("FileViewer", () => {
  it("renders PDFs in the PDF viewer", () => {
    renderViewer("docs/spec.pdf", PDF_LANGUAGE);

    expect(screen.getByTestId("pdf-viewer")).toHaveAttribute(
      "src",
      "/api/files/raw?workspaceId=ws-1&path=docs%2Fspec.pdf",
    );
    expect(screen.queryByTestId("editor-switcher")).not.toBeInTheDocument();
  });

  it("renders images in the image viewer", () => {
    renderViewer("assets/logo.png", IMAGE_LANGUAGE);

    expect(screen.getByRole("img", { name: "logo.png" })).toHaveAttribute(
      "src",
      "/api/files/raw?workspaceId=ws-1&path=assets%2Flogo.png",
    );
    expect(screen.queryByTestId("editor-switcher")).not.toBeInTheDocument();
  });

  it.each([
    [BINARY_FILE_LANGUAGE, "This file can't be displayed in the editor."],
    [LARGE_FILE_LANGUAGE, "This file is too large to display in the editor."],
  ])(
    "offers a download instead of the editor for %s",
    (language, expectedMessage) => {
      renderViewer("build/app.zip", language);

      expect(screen.getByText(expectedMessage)).toBeInTheDocument();
      const downloadLink = screen.getByRole("link", { name: "Download" });
      expect(downloadLink).toHaveAttribute(
        "href",
        "/api/files/raw?workspaceId=ws-1&path=build%2Fapp.zip&download=1",
      );
      expect(downloadLink).toHaveAttribute("download", "app.zip");
      expect(screen.queryByTestId("editor-switcher")).not.toBeInTheDocument();
    },
  );

  it("renders text files in the editor", () => {
    renderViewer("src/a.ts", "typescript", "const a = 1;");

    const editor = screen.getByTestId("editor-switcher");
    expect(editor).toHaveAttribute("data-language", "typescript");
    expect(editor).toHaveAttribute("data-content", "const a = 1;");
  });
});
