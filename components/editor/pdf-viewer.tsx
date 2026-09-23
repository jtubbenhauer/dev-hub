"use client";

import { getRawFileUrl } from "@/lib/file-preview";

interface PdfViewerProps {
  workspaceId: string;
  filePath: string;
}

export function PdfViewer({ workspaceId, filePath }: PdfViewerProps) {
  return (
    <iframe
      data-testid="pdf-viewer"
      src={getRawFileUrl(workspaceId, filePath)}
      title={filePath}
      className="h-full w-full border-0 bg-white"
    />
  );
}
