export const PDF_LANGUAGE = "pdf";

export function isPdfPath(filePath: string): boolean {
  return filePath.toLowerCase().endsWith(".pdf");
}

export function getRawFileUrl(workspaceId: string, filePath: string): string {
  const params = new URLSearchParams({ workspaceId, path: filePath });
  return `/api/files/raw?${params.toString()}`;
}
