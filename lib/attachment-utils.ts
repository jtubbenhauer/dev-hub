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
] as const;

export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export const MAX_ATTACHMENTS = 5;

function isMarkdownFile(file: File): boolean {
  return file.name.toLowerCase().endsWith(".md");
}

export function getAttachmentMimeType(file: File): string {
  return isMarkdownFile(file) ? "text/plain" : file.type;
}

export function createAttachmentPromptPart(
  attachment: SubmittedAttachment,
): AttachmentPromptPart {
  if (!attachment.filename.toLowerCase().endsWith(".md")) {
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
  return {
    type: "text",
    text: `Attached Markdown file ${JSON.stringify(attachment.filename)}:\n\n${content}`,
    synthetic: true,
  };
}

export function validateAttachment(file: File): {
  valid: boolean;
  error?: string;
} {
  const isAllowedType =
    isMarkdownFile(file) ||
    ALLOWED_MIME_TYPES.some((allowedType) => allowedType === file.type);
  if (!isAllowedType) {
    return {
      valid: false,
      error: `Unsupported file type "${file.type || "unknown"}". Allowed: PNG, JPEG, GIF, WebP, PDF, Markdown.`,
    };
  }
  if (file.size > MAX_FILE_SIZE) {
    return {
      valid: false,
      error: `File "${file.name}" exceeds 10MB limit (${(file.size / 1024 / 1024).toFixed(1)}MB).`,
    };
  }
  return { valid: true };
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error(`Failed to read file "${file.name}"`));
        return;
      }
      resolve(
        isMarkdownFile(file)
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
