export const PDF_LANGUAGE = "pdf";
export const IMAGE_LANGUAGE = "image";

export function isPdfPath(filePath: string): boolean {
  return filePath.toLowerCase().endsWith(".pdf");
}

const IMAGE_CONTENT_TYPES = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
  [".avif", "image/avif"],
  [".bmp", "image/bmp"],
  [".ico", "image/x-icon"],
]);

function getLowercaseExtension(filePath: string): string {
  const fileName = filePath.slice(filePath.lastIndexOf("/") + 1);
  const dotIndex = fileName.lastIndexOf(".");
  return dotIndex <= 0 ? "" : fileName.slice(dotIndex).toLowerCase();
}

export function isImagePath(filePath: string): boolean {
  return IMAGE_CONTENT_TYPES.has(getLowercaseExtension(filePath));
}

// SVG is deliberately excluded: it can carry scripts, so it is never served
// inline from the app origin and keeps opening as editable source text.
export function getRawFileContentType(filePath: string): string | null {
  if (isPdfPath(filePath)) return "application/pdf";
  return IMAGE_CONTENT_TYPES.get(getLowercaseExtension(filePath)) ?? null;
}

export function getBinaryPreviewLanguage(filePath: string): string | null {
  if (isPdfPath(filePath)) return PDF_LANGUAGE;
  if (isImagePath(filePath)) return IMAGE_LANGUAGE;
  return null;
}

export function isBinaryPreviewLanguage(language: string): boolean {
  return language === PDF_LANGUAGE || language === IMAGE_LANGUAGE;
}

// Files the content API refuses (binary bytes or over its size limit) still
// open, but as a download notice instead of an editor.
export const BINARY_FILE_LANGUAGE = "binary-file";
export const LARGE_FILE_LANGUAGE = "large-file";

export function getUnsupportedFileMessage(language: string): string | null {
  if (language === BINARY_FILE_LANGUAGE) {
    return "This file can't be displayed in the editor.";
  }
  if (language === LARGE_FILE_LANGUAGE) {
    return "This file is too large to display in the editor.";
  }
  return null;
}

export function isTextEditorLanguage(language: string): boolean {
  return (
    !isBinaryPreviewLanguage(language) &&
    getUnsupportedFileMessage(language) === null
  );
}

export function getFileName(filePath: string): string {
  return filePath.split("/").pop() || filePath;
}

export function isCsvPath(filePath: string): boolean {
  return filePath.toLowerCase().endsWith(".csv");
}

export const MARKDOWN_LANGUAGE = "markdown";

export function isMarkdownLanguage(language: string): boolean {
  return language === MARKDOWN_LANGUAGE;
}

const FRONTMATTER_PATTERN = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/;

export function stripFrontmatter(markdown: string): string {
  return markdown.replace(FRONTMATTER_PATTERN, "");
}

export function getRawFileUrl(workspaceId: string, filePath: string): string {
  const params = new URLSearchParams({ workspaceId, path: filePath });
  return `/api/files/raw?${params.toString()}`;
}

export function getRawFileDownloadUrl(
  workspaceId: string,
  filePath: string,
): string {
  const params = new URLSearchParams({
    workspaceId,
    path: filePath,
    download: "1",
  });
  return `/api/files/raw?${params.toString()}`;
}

// Previews download their raw bytes and refused files download as an
// attachment. Text files return null: they download the editor buffer, which
// may hold unsaved edits.
export function getFileDownloadUrl(
  workspaceId: string,
  filePath: string,
  language: string,
): string | null {
  if (isBinaryPreviewLanguage(language)) {
    return getRawFileUrl(workspaceId, filePath);
  }
  if (getUnsupportedFileMessage(language) !== null) {
    return getRawFileDownloadUrl(workspaceId, filePath);
  }
  return null;
}
