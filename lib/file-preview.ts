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
