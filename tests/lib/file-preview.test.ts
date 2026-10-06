import { describe, expect, it } from "vitest";
import {
  getBinaryPreviewLanguage,
  getRawFileContentType,
  getRawFileUrl,
  IMAGE_LANGUAGE,
  isBinaryPreviewLanguage,
  isImagePath,
  isPdfPath,
  PDF_LANGUAGE,
} from "@/lib/file-preview";

describe("isPdfPath", () => {
  it("matches .pdf case-insensitively", () => {
    expect(isPdfPath("docs/report.pdf")).toBe(true);
    expect(isPdfPath("docs/REPORT.PDF")).toBe(true);
  });

  it("rejects other files", () => {
    expect(isPdfPath("docs/report.pdf.txt")).toBe(false);
    expect(isPdfPath("src/pdf.ts")).toBe(false);
  });
});

describe("isImagePath", () => {
  it("matches common raster image extensions case-insensitively", () => {
    for (const filePath of [
      "assets/logo.png",
      "photos/IMG_0001.JPG",
      "photos/cover.jpeg",
      "anim.gif",
      "hero.webp",
      "hero.avif",
      "legacy.bmp",
      "public/favicon.ico",
    ]) {
      expect(isImagePath(filePath)).toBe(true);
    }
  });

  it("rejects SVG, look-alike names, and extensionless files", () => {
    expect(isImagePath("icons/logo.svg")).toBe(false);
    expect(isImagePath("src/png.ts")).toBe(false);
    expect(isImagePath("assets/logo.png.txt")).toBe(false);
    expect(isImagePath("assets.png/README")).toBe(false);
    expect(isImagePath(".png")).toBe(false);
  });
});

describe("getRawFileContentType", () => {
  it("returns the content type for PDFs and images", () => {
    expect(getRawFileContentType("docs/report.PDF")).toBe("application/pdf");
    expect(getRawFileContentType("assets/logo.png")).toBe("image/png");
    expect(getRawFileContentType("photos/cover.JPG")).toBe("image/jpeg");
    expect(getRawFileContentType("public/favicon.ico")).toBe("image/x-icon");
  });

  it("returns null for files that must never be served raw", () => {
    expect(getRawFileContentType("index.html")).toBeNull();
    expect(getRawFileContentType("icons/logo.svg")).toBeNull();
    expect(getRawFileContentType("src/app.ts")).toBeNull();
  });
});

describe("getBinaryPreviewLanguage", () => {
  it("maps PDFs and images to their preview languages", () => {
    expect(getBinaryPreviewLanguage("docs/spec.pdf")).toBe(PDF_LANGUAGE);
    expect(getBinaryPreviewLanguage("assets/logo.png")).toBe(IMAGE_LANGUAGE);
  });

  it("returns null for text files", () => {
    expect(getBinaryPreviewLanguage("src/app.ts")).toBeNull();
    expect(getBinaryPreviewLanguage("icons/logo.svg")).toBeNull();
  });
});

describe("isBinaryPreviewLanguage", () => {
  it("is true only for preview languages", () => {
    expect(isBinaryPreviewLanguage(PDF_LANGUAGE)).toBe(true);
    expect(isBinaryPreviewLanguage(IMAGE_LANGUAGE)).toBe(true);
    expect(isBinaryPreviewLanguage("typescript")).toBe(false);
  });
});

describe("getRawFileUrl", () => {
  it("encodes the workspace and path as query params", () => {
    expect(getRawFileUrl("ws-1", "docs/a b&c.pdf")).toBe(
      "/api/files/raw?workspaceId=ws-1&path=docs%2Fa+b%26c.pdf",
    );
  });
});
