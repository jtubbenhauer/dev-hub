import { extractDocxText, extractXlsxText } from "@/lib/office-text";

export interface Attachment {
  id: string;
  file: File;
  dataUrl: string;
  mime: string;
  filename: string;
}

type SubmittedAttachment = {
  readonly mime: string;
  readonly dataUrl: string;
  readonly filename: string;
};

type AttachmentPromptPart =
  | {
      readonly type: "file";
      readonly mime: string;
      readonly url: string;
      readonly filename: string;
    }
  | { readonly type: "text"; readonly text: string; readonly synthetic: true };

export const ALLOWED_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
] as const;

// Not redundant with ALLOWED_MIME_TYPES: browsers disagree on Office/CSV MIME
// types, so the picker also needs to match on extension.
export const ALLOWED_FILE_EXTENSIONS = [
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".pdf",
  ".docx",
  ".xlsx",
  ".csv",
  ".md",
] as const;

export const ALLOWED_TYPES_LABEL =
  "PNG, JPEG, GIF, WebP, PDF, Word (.docx), Excel (.xlsx), CSV, Markdown";

// Legacy .doc/.xls are OLE binaries rather than zipped XML, so their text cannot
// be extracted the way .docx/.xlsx can.
const LEGACY_OFFICE_EXTENSIONS = [".doc", ".xls"] as const;

export const FILE_INPUT_ACCEPT = [
  ...ALLOWED_MIME_TYPES,
  "text/markdown",
  ...ALLOWED_FILE_EXTENSIONS,
].join(",");

const BYTES_PER_MB = 1024 * 1024;

export const MAX_FILE_SIZE = 20 * BYTES_PER_MB;

export const MAX_ATTACHMENTS = 10;

// Models reject text/csv and text/markdown as file parts (only application/pdf
// and text/plain are accepted), so these are inlined into the prompt as text.
const INLINE_TEXT_EXTENSIONS = [".md", ".csv"] as const;

function hasExtension(
  filename: string,
  extensions: readonly string[],
): boolean {
  const lowerName = filename.toLowerCase();
  return extensions.some((extension) => lowerName.endsWith(extension));
}

function isInlineTextFile(filename: string): boolean {
  return hasExtension(filename, INLINE_TEXT_EXTENSIONS);
}

export function isDocxFile(filename: string): boolean {
  return hasExtension(filename, [".docx"]);
}

export function isXlsxFile(filename: string): boolean {
  return hasExtension(filename, [".xlsx"]);
}

export function isLegacyOfficeFile(filename: string): boolean {
  return hasExtension(filename, LEGACY_OFFICE_EXTENSIONS);
}

export function isExtractedOfficeFile(filename: string): boolean {
  return isDocxFile(filename) || isXlsxFile(filename);
}

export function isAttachableFile(file: File): boolean {
  if (isLegacyOfficeFile(file.name)) return false;
  return (
    isInlineTextFile(file.name) ||
    ALLOWED_MIME_TYPES.some((allowedType) => allowedType === file.type)
  );
}

export function getAttachmentMimeType(file: File): string {
  return isInlineTextFile(file.name) || isExtractedOfficeFile(file.name)
    ? "text/plain"
    : file.type;
}

export function createAttachmentPromptPart(
  attachment: SubmittedAttachment,
): AttachmentPromptPart {
  const isInlined =
    isInlineTextFile(attachment.filename) ||
    isExtractedOfficeFile(attachment.filename);

  if (!isInlined) {
    return {
      type: "file",
      mime: attachment.mime,
      url: attachment.dataUrl,
      filename: attachment.filename,
    };
  }

  const encodedContent = attachment.dataUrl.slice(
    attachment.dataUrl.indexOf(",") + 1,
  );
  const bytes = Uint8Array.from(atob(encodedContent), (character) =>
    character.charCodeAt(0),
  );
  const content = new TextDecoder().decode(bytes);
  const header = isExtractedOfficeFile(attachment.filename)
    ? `Text extracted from ${JSON.stringify(attachment.filename)} (formatting and embedded images are not preserved):`
    : `Attached file ${JSON.stringify(attachment.filename)}:`;

  return {
    type: "text",
    text: `${header}\n\n${content}`,
    synthetic: true,
  };
}

export function validateAttachment(file: File): {
  valid: boolean;
  error?: string;
} {
  if (isLegacyOfficeFile(file.name)) {
    return {
      valid: false,
      error: `Legacy Office files are not supported. Save "${file.name}" as .docx, .xlsx, or PDF and try again.`,
    };
  }
  if (!isAttachableFile(file)) {
    return {
      valid: false,
      error: `Unsupported file type "${file.type || "unknown"}". Allowed: ${ALLOWED_TYPES_LABEL}.`,
    };
  }
  if (file.size > MAX_FILE_SIZE) {
    return {
      valid: false,
      error: `File "${file.name}" exceeds ${MAX_FILE_SIZE / BYTES_PER_MB}MB limit (${(file.size / BYTES_PER_MB).toFixed(1)}MB).`,
    };
  }
  return { valid: true };
}

function encodeTextAsDataUrl(text: string): string {
  const utf8Bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of utf8Bytes) binary += String.fromCharCode(byte);
  return `data:text/plain;base64,${btoa(binary)}`;
}

export async function fileToDataUrl(file: File): Promise<string> {
  if (isExtractedOfficeFile(file.name)) {
    const extractedText = isDocxFile(file.name)
      ? await extractDocxText(file)
      : await extractXlsxText(file);
    return encodeTextAsDataUrl(extractedText);
  }
  return readFileAsDataUrl(file);
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error(`Failed to read file "${file.name}"`));
        return;
      }
      resolve(
        isInlineTextFile(file.name)
          ? reader.result.replace(/^data:[^;,]*/, "data:text/plain")
          : reader.result,
      );
    };
    reader.onerror = () =>
      reject(new Error(`Failed to read file "${file.name}"`));
    reader.readAsDataURL(file);
  });
}

export function generateAttachmentId(): string {
  return `attachment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
