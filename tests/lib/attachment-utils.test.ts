import { describe, it, expect, vi } from "vitest";
import {
  validateAttachment,
  fileToDataUrl,
  generateAttachmentId,
  MAX_FILE_SIZE,
  MAX_ATTACHMENTS,
  ALLOWED_MIME_TYPES,
} from "@/lib/attachment-utils";

function createMockFile(name: string, size: number, type: string): File {
  const content = new Uint8Array(size);
  return new File([content], name, { type });
}

describe("constants", () => {
  it("MAX_FILE_SIZE is 10MB", () => {
    expect(MAX_FILE_SIZE).toBe(10 * 1024 * 1024);
  });

  it("MAX_ATTACHMENTS is 5", () => {
    expect(MAX_ATTACHMENTS).toBe(5);
  });

  it("ALLOWED_MIME_TYPES includes all 4 image types", () => {
    expect(ALLOWED_MIME_TYPES).toContain("image/png");
    expect(ALLOWED_MIME_TYPES).toContain("image/jpeg");
    expect(ALLOWED_MIME_TYPES).toContain("image/gif");
    expect(ALLOWED_MIME_TYPES).toContain("image/webp");
    expect(ALLOWED_MIME_TYPES).toHaveLength(4);
  });
});

describe("validateAttachment", () => {
  it("returns valid: true for PNG file", () => {
    const file = createMockFile("image.png", 1024, "image/png");
    expect(validateAttachment(file)).toEqual({ valid: true });
  });

  it("returns valid: true for JPEG file", () => {
    const file = createMockFile("image.jpg", 1024, "image/jpeg");
    expect(validateAttachment(file)).toEqual({ valid: true });
  });

  it("returns valid: true for GIF file", () => {
    const file = createMockFile("image.gif", 1024, "image/gif");
    expect(validateAttachment(file)).toEqual({ valid: true });
  });

  it("returns valid: true for WebP file", () => {
    const file = createMockFile("image.webp", 1024, "image/webp");
    expect(validateAttachment(file)).toEqual({ valid: true });
  });

  it("returns valid: false for unsupported file type", () => {
    const file = createMockFile("doc.txt", 1024, "text/plain");
    const result = validateAttachment(file);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("text/plain");
    expect(result.error).toContain("Unsupported file type");
  });

  it("returns valid: false for file exceeding 10MB limit", () => {
    const size = MAX_FILE_SIZE + 1;
    const file = createMockFile("big.png", size, "image/png");
    const result = validateAttachment(file);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("big.png");
    expect(result.error).toContain("10MB");
  });

  it("returns valid: false for empty mime type", () => {
    const file = createMockFile("unknown", 1024, "");
    const result = validateAttachment(file);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("unknown");
  });
});

describe("fileToDataUrl", () => {
  it("resolves with data URL on success", async () => {
    const file = createMockFile("image.png", 4, "image/png");
    const fakeDataUrl = "data:image/png;base64,AAAA";

    vi.stubGlobal(
      "FileReader",
      vi.fn(function (this: {
        onload: (() => void) | null;
        onerror: (() => void) | null;
        result: string;
        readAsDataURL: () => void;
      }) {
        this.onload = null;
        this.onerror = null;
        this.result = fakeDataUrl;
        this.readAsDataURL = () => {
          setTimeout(() => this.onload?.(), 0);
        };
      }),
    );

    const result = await fileToDataUrl(file);
    expect(result).toBe(fakeDataUrl);

    vi.unstubAllGlobals();
  });

  it("rejects with error on FileReader error", async () => {
    const file = createMockFile("image.png", 4, "image/png");

    vi.stubGlobal(
      "FileReader",
      vi.fn(function (this: {
        onload: (() => void) | null;
        onerror: (() => void) | null;
        result: null;
        readAsDataURL: () => void;
      }) {
        this.onload = null;
        this.onerror = null;
        this.result = null;
        this.readAsDataURL = () => {
          setTimeout(() => this.onerror?.(), 0);
        };
      }),
    );

    await expect(fileToDataUrl(file)).rejects.toThrow(
      `Failed to read file "image.png"`,
    );

    vi.unstubAllGlobals();
  });
});

describe("generateAttachmentId", () => {
  it("returns a string starting with 'attachment-'", () => {
    const id = generateAttachmentId();
    expect(typeof id).toBe("string");
    expect(id.startsWith("attachment-")).toBe(true);
  });

  it("returns unique IDs on consecutive calls", () => {
    const id1 = generateAttachmentId();
    const id2 = generateAttachmentId();
    expect(id1).not.toBe(id2);
  });
});
