export interface Attachment {
  id: string;
  file: File;
  dataUrl: string;
  mime: string;
  filename: string;
}

export const ALLOWED_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
] as const;

export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export const MAX_ATTACHMENTS = 5;

export function validateAttachment(file: File): {
  valid: boolean;
  error?: string;
} {
  if (
    !ALLOWED_MIME_TYPES.includes(
      file.type as (typeof ALLOWED_MIME_TYPES)[number],
    )
  ) {
    return {
      valid: false,
      error: `Unsupported file type "${file.type || "unknown"}". Allowed: PNG, JPEG, GIF, WebP.`,
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
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () =>
      reject(new Error(`Failed to read file "${file.name}"`));
    reader.readAsDataURL(file);
  });
}

export function generateAttachmentId(): string {
  return `attachment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
