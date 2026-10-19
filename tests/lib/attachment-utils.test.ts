import { afterEach, describe, it, expect, vi } from "vitest";
import {
  validateAttachment,
  fileToDataUrl,
  generateAttachmentId,
  MAX_FILE_SIZE,
  MAX_ATTACHMENTS,
  MAX_INLINE_TEXT_BYTES,
  ALLOWED_MIME_TYPES,
  FILE_INPUT_ACCEPT,
  isAttachableFile,
  getAttachmentMimeType,
  createAttachmentPromptPart,
  splitAttachmentsForUpload,
  buildWorkspaceUploadsContext,
  uploadAttachmentToWorkspace,
  WORKSPACE_UPLOADS_CONTEXT_PREFIX,
} from "@/lib/attachment-utils";

function createMockFile(name: string, size: number, type: string): File {
  const content = new Uint8Array(size);
  return new File([content], name, { type });
}

function textDataUrl(byteLength: number): string {
  return `data:text/plain;base64,${btoa("a".repeat(byteLength))}`;
}

describe("constants", () => {
  it("MAX_FILE_SIZE is 20MB", () => {
    expect(MAX_FILE_SIZE).toBe(20 * 1024 * 1024);
  });

  it("MAX_INLINE_TEXT_BYTES is 256KB", () => {
    expect(MAX_INLINE_TEXT_BYTES).toBe(256 * 1024);
  });

  it("MAX_ATTACHMENTS is 10", () => {
    expect(MAX_ATTACHMENTS).toBe(10);
  });

  it("ALLOWED_MIME_TYPES includes all supported types", () => {
    expect(ALLOWED_MIME_TYPES).toEqual([
      "image/png",
      "image/jpeg",
      "image/gif",
      "image/webp",
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "text/csv",
    ]);
  });

  it("excludes legacy Office MIME types that cannot be text-extracted", () => {
    expect(ALLOWED_MIME_TYPES).not.toContain("application/msword");
    expect(ALLOWED_MIME_TYPES).not.toContain("application/vnd.ms-excel");
  });

  it("FILE_INPUT_ACCEPT exposes every allowed MIME type to the file picker", () => {
    const acceptedValues = FILE_INPUT_ACCEPT.split(",");
    for (const mimeType of ALLOWED_MIME_TYPES) {
      expect(acceptedValues).toContain(mimeType);
    }
  });

  it("FILE_INPUT_ACCEPT exposes document extensions for browsers that report other MIME types", () => {
    const acceptedValues = FILE_INPUT_ACCEPT.split(",");
    for (const extension of [".docx", ".xlsx", ".csv", ".md", ".json"]) {
      expect(acceptedValues).toContain(extension);
    }
  });

  it("FILE_INPUT_ACCEPT exposes the JSON MIME type to the file picker", () => {
    expect(FILE_INPUT_ACCEPT.split(",")).toContain("application/json");
  });

  it("does not offer legacy Office extensions in the file picker", () => {
    const acceptedValues = FILE_INPUT_ACCEPT.split(",");
    expect(acceptedValues).not.toContain(".doc");
    expect(acceptedValues).not.toContain(".xls");
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

  it("returns valid: true for PDF file", () => {
    const file = createMockFile("document.pdf", 1024, "application/pdf");
    expect(validateAttachment(file)).toEqual({ valid: true });
  });

  it("rejects legacy .doc files with guidance to convert", () => {
    const file = createMockFile("report.doc", 1024, "application/msword");
    const result = validateAttachment(file);

    expect(result.valid).toBe(false);
    expect(result.error).toContain("Legacy Office files are not supported");
    expect(result.error).toContain(".docx");
  });

  it("rejects legacy .xls files with guidance to convert", () => {
    const file = createMockFile("data.xls", 1024, "application/vnd.ms-excel");
    const result = validateAttachment(file);

    expect(result.valid).toBe(false);
    expect(result.error).toContain("Legacy Office files are not supported");
  });

  it("still accepts a .csv that the browser reports as application/vnd.ms-excel", () => {
    const file = createMockFile("rows.csv", 1024, "application/vnd.ms-excel");
    expect(validateAttachment(file)).toEqual({ valid: true });
  });

  it("returns valid: true for Word file", () => {
    const file = createMockFile(
      "report.docx",
      1024,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(validateAttachment(file)).toEqual({ valid: true });
  });

  it("returns valid: true for Excel file", () => {
    const file = createMockFile(
      "data.xlsx",
      1024,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(validateAttachment(file)).toEqual({ valid: true });
  });

  it("returns valid: true for CSV file", () => {
    const file = createMockFile("rows.csv", 1024, "text/csv");
    expect(validateAttachment(file)).toEqual({ valid: true });
  });

  it("returns valid: true for Markdown file", () => {
    const file = createMockFile("notes.md", 1024, "text/markdown");
    expect(validateAttachment(file)).toEqual({ valid: true });
  });

  it("returns valid: true for Markdown file without a MIME type", () => {
    const file = createMockFile("notes.MD", 1024, "");
    expect(validateAttachment(file)).toEqual({ valid: true });
  });

  it("returns valid: true for JSON file", () => {
    const file = createMockFile("config.json", 1024, "application/json");
    expect(validateAttachment(file)).toEqual({ valid: true });
  });

  it("returns valid: true for JSON file without a MIME type", () => {
    const file = createMockFile("config.JSON", 1024, "");
    expect(validateAttachment(file)).toEqual({ valid: true });
  });

  it("lists JSON among the allowed types when rejecting a file", () => {
    const file = createMockFile("page.html", 1024, "text/html");
    expect(validateAttachment(file).error).toContain("JSON");
  });

  it("accepts a text file far over the inline text limit, since it is saved to the workspace", () => {
    const file = createMockFile(
      "dump.json",
      16 * 1024 * 1024,
      "application/json",
    );
    expect(validateAttachment(file)).toEqual({ valid: true });
  });

  it("still rejects text files over the file size limit", () => {
    const file = createMockFile(
      "dump.json",
      MAX_FILE_SIZE + 1,
      "application/json",
    );
    const result = validateAttachment(file);

    expect(result.valid).toBe(false);
    expect(result.error).toContain(`${MAX_FILE_SIZE / (1024 * 1024)}MB limit`);
  });

  it("returns valid: false for PDF file exceeding the size limit", () => {
    const size = MAX_FILE_SIZE + 1;
    const file = createMockFile("big.pdf", size, "application/pdf");
    const result = validateAttachment(file);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("big.pdf");
    expect(result.error).toContain(`${MAX_FILE_SIZE / (1024 * 1024)}MB limit`);
  });

  it("accepts a file just under the size limit", () => {
    const file = createMockFile("big.pdf", MAX_FILE_SIZE, "application/pdf");
    expect(validateAttachment(file)).toEqual({ valid: true });
  });

  it("returns valid: false for unsupported file type", () => {
    const file = createMockFile("doc.txt", 1024, "text/plain");
    const result = validateAttachment(file);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("text/plain");
    expect(result.error).toContain("Unsupported file type");
  });

  it("returns valid: false for file exceeding the size limit", () => {
    const size = MAX_FILE_SIZE + 1;
    const file = createMockFile("big.png", size, "image/png");
    const result = validateAttachment(file);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("big.png");
    expect(result.error).toContain(`${MAX_FILE_SIZE / (1024 * 1024)}MB limit`);
  });

  it("returns valid: false for empty mime type", () => {
    const file = createMockFile("unknown", 1024, "");
    const result = validateAttachment(file);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("unknown");
  });
});

describe("splitAttachmentsForUpload", () => {
  it("inlines text attachments that together fit the inline limit exactly", () => {
    const attachments = [
      {
        filename: "rows.csv",
        dataUrl: textDataUrl(MAX_INLINE_TEXT_BYTES - 1000),
      },
      { filename: "data.json", dataUrl: textDataUrl(1000) },
    ];

    expect(splitAttachmentsForUpload(attachments)).toEqual({
      attachmentsToSend: attachments,
      attachmentsToUpload: [],
    });
  });

  it("uploads the text attachment that would push the message over the limit", () => {
    const rows = { filename: "rows.csv", dataUrl: textDataUrl(200 * 1024) };
    const data = { filename: "data.json", dataUrl: textDataUrl(100 * 1024) };

    expect(splitAttachmentsForUpload([rows, data])).toEqual({
      attachmentsToSend: [rows],
      attachmentsToUpload: [data],
    });
  });

  it("keeps inlining later text attachments that still fit", () => {
    const rows = { filename: "rows.csv", dataUrl: textDataUrl(200 * 1024) };
    const data = { filename: "data.json", dataUrl: textDataUrl(100 * 1024) };
    const notes = { filename: "notes.md", dataUrl: textDataUrl(10 * 1024) };

    expect(splitAttachmentsForUpload([rows, data, notes])).toEqual({
      attachmentsToSend: [rows, notes],
      attachmentsToUpload: [data],
    });
  });

  it("never uploads images or PDFs, which are sent as files", () => {
    const largeBase64 = "A".repeat(4 * MAX_INLINE_TEXT_BYTES);
    const photo = {
      filename: "photo.png",
      dataUrl: `data:image/png;base64,${largeBase64}`,
    };
    const document = {
      filename: "doc.pdf",
      dataUrl: `data:application/pdf;base64,${largeBase64}`,
    };

    expect(splitAttachmentsForUpload([photo, document])).toEqual({
      attachmentsToSend: [photo, document],
      attachmentsToUpload: [],
    });
  });

  it("uploads Office files whose extracted text is over the limit", () => {
    const report = {
      filename: "report.docx",
      dataUrl: textDataUrl(MAX_INLINE_TEXT_BYTES + 1),
    };

    expect(splitAttachmentsForUpload([report]).attachmentsToUpload).toEqual([
      report,
    ]);
  });
});

describe("buildWorkspaceUploadsContext", () => {
  it("references each saved file by name, size and workspace path", () => {
    const context = buildWorkspaceUploadsContext([
      {
        filename: "data.json",
        path: ".devhub/uploads/20261013-013045-3f9a2c-data.json",
        sizeBytes: 16 * 1024 * 1024,
      },
      {
        filename: "rows.csv",
        path: ".devhub/uploads/20261013-013045-a1b2c3-rows.csv",
        sizeBytes: 300 * 1024,
      },
    ]);

    expect(context.startsWith(WORKSPACE_UPLOADS_CONTEXT_PREFIX)).toBe(true);
    expect(context).toContain(
      '- "data.json" (16.0MB): .devhub/uploads/20261013-013045-3f9a2c-data.json',
    );
    expect(context).toContain(
      '- "rows.csv" (300KB): .devhub/uploads/20261013-013045-a1b2c3-rows.csv',
    );
    expect(context).toContain("read them with your tools");
    expect(context.endsWith("\n\n")).toBe(true);
  });
});

describe("uploadAttachmentToWorkspace", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }

  it("posts the attachment to the upload route and returns where it was saved", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({ path: ".devhub/uploads/x-data.json", sizeBytes: 307200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const dataUrl = textDataUrl(300 * 1024);

    const upload = await uploadAttachmentToWorkspace("ws-1", {
      filename: "data.json",
      dataUrl,
    });

    expect(upload).toEqual({
      filename: "data.json",
      path: ".devhub/uploads/x-data.json",
      sizeBytes: 307200,
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/files/upload");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      workspaceId: "ws-1",
      filename: "data.json",
      dataUrl,
    });
  });

  it("saves Office files under a .txt name because their extracted text is uploaded", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({ path: ".devhub/uploads/x-report.docx.txt", sizeBytes: 9 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const upload = await uploadAttachmentToWorkspace("ws-1", {
      filename: "report.docx",
      dataUrl: textDataUrl(9),
    });

    expect(upload.filename).toBe("report.docx");
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(init?.body)).filename).toBe("report.docx.txt");
  });

  it("includes the server's error when saving fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () =>
        jsonResponse({ error: "Agent request failed: 500" }, 500),
      ),
    );

    await expect(
      uploadAttachmentToWorkspace("ws-1", {
        filename: "data.json",
        dataUrl: textDataUrl(10),
      }),
    ).rejects.toThrow(
      'Failed to save "data.json" to the workspace: Agent request failed: 500',
    );
  });
});

describe("isAttachableFile", () => {
  it("accepts document files pasted from the clipboard", () => {
    const file = createMockFile("rows.csv", 1024, "text/csv");
    expect(isAttachableFile(file)).toBe(true);
  });

  it("accepts Markdown files by extension when the MIME type is text/markdown", () => {
    const file = createMockFile("notes.md", 1024, "text/markdown");
    expect(isAttachableFile(file)).toBe(true);
  });

  it("rejects clipboard files that are not attachable", () => {
    const file = createMockFile("clipboard.html", 1024, "text/html");
    expect(isAttachableFile(file)).toBe(false);
  });
});

describe("getAttachmentMimeType", () => {
  it("uses an OpenCode-compatible MIME type for Markdown files", () => {
    const file = createMockFile("notes.md", 1024, "text/markdown");
    expect(getAttachmentMimeType(file)).toBe("text/plain");
  });

  it("remaps CSV files to text/plain because models reject text/csv", () => {
    const file = createMockFile("rows.csv", 1024, "text/csv");
    expect(getAttachmentMimeType(file)).toBe("text/plain");
  });

  it("remaps JSON files to text/plain because models reject application/json", () => {
    const file = createMockFile("config.json", 1024, "application/json");
    expect(getAttachmentMimeType(file)).toBe("text/plain");
  });

  it("preserves the MIME type for file types models accept directly", () => {
    const file = createMockFile("doc.pdf", 1024, "application/pdf");
    expect(getAttachmentMimeType(file)).toBe("application/pdf");
  });

  it("remaps Word and Excel files to text/plain because their text is extracted", () => {
    const docx = createMockFile(
      "memo.docx",
      1024,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    const xlsx = createMockFile(
      "data.xlsx",
      1024,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );

    expect(getAttachmentMimeType(docx)).toBe("text/plain");
    expect(getAttachmentMimeType(xlsx)).toBe("text/plain");
  });
});

describe("createAttachmentPromptPart", () => {
  it("converts Markdown attachments to text context", () => {
    const part = createAttachmentPromptPart({
      mime: "text/plain",
      dataUrl: "data:text/plain;base64,IyBIZWFkaW5n",
      filename: "notes.md",
    });

    expect(part.type).toBe("text");
    expect("text" in part && part.text).toContain("# Heading");
    expect("text" in part && part.text).toContain("notes.md");
  });

  it("converts CSV attachments to text context instead of a rejected file part", () => {
    const part = createAttachmentPromptPart({
      mime: "text/plain",
      dataUrl: `data:text/plain;base64,${btoa("name,city\nAda,London\n")}`,
      filename: "rows.csv",
    });

    expect(part.type).toBe("text");
    expect("text" in part && part.text).toContain("name,city");
    expect("text" in part && part.text).toContain("Ada,London");
    expect("text" in part && part.text).toContain("rows.csv");
  });

  it("never emits a text/csv file part, which models reject", () => {
    const part = createAttachmentPromptPart({
      mime: "text/csv",
      dataUrl: `data:text/csv;base64,${btoa("a,b\n1,2\n")}`,
      filename: "rows.csv",
    });

    expect(part.type).not.toBe("file");
    expect("mime" in part).toBe(false);
  });

  it("converts JSON attachments to text context, preserving UTF-8 content", () => {
    const json = '{"name": "Zoë", "tags": ["a", "b"]}';
    const utf8Base64 = btoa(
      String.fromCharCode(...new TextEncoder().encode(json)),
    );
    const part = createAttachmentPromptPart({
      mime: "text/plain",
      dataUrl: `data:text/plain;base64,${utf8Base64}`,
      filename: "config.json",
    });

    expect(part.type).toBe("text");
    expect("text" in part && part.text).toContain(json);
    expect("text" in part && part.text).toContain("config.json");
  });

  it("never emits an application/json file part, which models reject", () => {
    const part = createAttachmentPromptPart({
      mime: "application/json",
      dataUrl: `data:application/json;base64,${btoa('{"a":1}')}`,
      filename: "config.json",
    });

    expect(part.type).toBe("text");
    expect("mime" in part).toBe(false);
  });

  it("inlines extracted Word content and flags the fidelity loss", () => {
    const part = createAttachmentPromptPart({
      mime: "text/plain",
      dataUrl: `data:text/plain;base64,${btoa("Codeword: PLATYPUS")}`,
      filename: "memo.docx",
    });

    expect(part.type).toBe("text");
    expect("text" in part && part.text).toContain("Codeword: PLATYPUS");
    expect("text" in part && part.text).toContain("Text extracted from");
    expect("text" in part && part.text).toContain(
      "formatting and embedded images are not preserved",
    );
  });

  it("inlines extracted Excel content instead of sending a rejected file part", () => {
    const part = createAttachmentPromptPart({
      mime: "text/plain",
      dataUrl: `data:text/plain;base64,${btoa("# Sheet1\na,b")}`,
      filename: "data.xlsx",
    });

    expect(part.type).toBe("text");
    expect("mime" in part).toBe(false);
    expect("text" in part && part.text).toContain("a,b");
  });

  it("keeps PDF attachments as file parts", () => {
    const part = createAttachmentPromptPart({
      mime: "application/pdf",
      dataUrl: "data:application/pdf;base64,JVBERi0=",
      filename: "doc.pdf",
    });

    expect(part.type).toBe("file");
    expect("mime" in part && part.mime).toBe("application/pdf");
  });
});

describe("fileToDataUrl", () => {
  it("uses text/plain in Markdown data URLs", async () => {
    const file = createMockFile("notes.md", 4, "text/markdown");

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
        this.result = "data:text/markdown;base64,AAAA";
        this.readAsDataURL = () => {
          this.onload?.();
        };
      }),
    );

    await expect(fileToDataUrl(file)).resolves.toBe(
      "data:text/plain;base64,AAAA",
    );

    vi.unstubAllGlobals();
  });

  it("uses text/plain in JSON data URLs", async () => {
    const file = createMockFile("config.json", 4, "application/json");

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
        this.result = "data:application/json;base64,e30=";
        this.readAsDataURL = () => {
          this.onload?.();
        };
      }),
    );

    await expect(fileToDataUrl(file)).resolves.toBe(
      "data:text/plain;base64,e30=",
    );

    vi.unstubAllGlobals();
  });

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
