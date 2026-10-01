export const PDF_LANGUAGE = "pdf";

export function isPdfPath(filePath: string): boolean {
  return filePath.toLowerCase().endsWith(".pdf");
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
