import { downloadTextFile } from "@/lib/download-file";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("downloadTextFile", () => {
  const originalCreateObjectUrl = URL.createObjectURL;
  const originalRevokeObjectUrl = URL.revokeObjectURL;

  afterEach(() => {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: originalCreateObjectUrl,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: originalRevokeObjectUrl,
    });
    vi.restoreAllMocks();
  });

  it("downloads the current text content with the requested filename", async () => {
    let downloadedHref = "";
    let downloadedName = "";
    const createObjectUrl = vi.fn((_blob: Blob) => "blob:download");
    const revokeObjectUrl = vi.fn();

    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectUrl,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectUrl,
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloadedHref = this.href;
      downloadedName = this.download;
    });

    downloadTextFile("notes.md", "latest editor content");

    const downloadedBlob = createObjectUrl.mock.calls[0]?.[0];
    expect(downloadedName).toBe("notes.md");
    expect(downloadedHref).toBe("blob:download");
    expect(downloadedBlob).toBeInstanceOf(Blob);
    expect(await downloadedBlob?.text()).toBe("latest editor content");
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:download");
  });
});
