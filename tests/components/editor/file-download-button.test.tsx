import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { FileDownloadButton } from "@/components/editor/file-download-button";
import { downloadTextFile } from "@/lib/download-file";
import { BINARY_FILE_LANGUAGE, PDF_LANGUAGE } from "@/lib/file-preview";

vi.mock("@/lib/download-file", () => ({
  downloadTextFile: vi.fn(),
}));

describe("FileDownloadButton", () => {
  beforeEach(() => vi.mocked(downloadTextFile).mockClear());

  it("downloads the current buffer for text files", async () => {
    render(
      <FileDownloadButton
        workspaceId="ws-1"
        filePath="src/example.ts"
        language="typescript"
        content="edited"
      />,
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Download file" }),
    );

    expect(downloadTextFile).toHaveBeenCalledWith("example.ts", "edited");
  });

  it.each([
    [PDF_LANGUAGE, "/api/files/raw?workspaceId=ws-1&path=docs%2Fa.pdf"],
    [
      BINARY_FILE_LANGUAGE,
      "/api/files/raw?workspaceId=ws-1&path=docs%2Fa.pdf&download=1",
    ],
  ])("links %s files to the raw file route", (language, expectedUrl) => {
    render(
      <FileDownloadButton
        workspaceId="ws-1"
        filePath="docs/a.pdf"
        language={language}
        content=""
      />,
    );

    const downloadLink = screen.getByRole("link", { name: "Download file" });
    expect(downloadLink).toHaveAttribute("href", expectedUrl);
    expect(downloadLink).toHaveAttribute("download", "a.pdf");
  });
});
