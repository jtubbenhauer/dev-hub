"use client";

import type { ComponentProps } from "react";
import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import { downloadTextFile } from "@/lib/download-file";
import { getFileDownloadUrl, getFileName } from "@/lib/file-preview";

interface FileDownloadButtonProps {
  workspaceId: string;
  filePath: string;
  language: string;
  content: string;
  size?: ComponentProps<typeof Button>["size"];
  className?: string;
  iconClassName?: string;
}

export function FileDownloadButton({
  workspaceId,
  filePath,
  language,
  content,
  size = "sm",
  className,
  iconClassName = "size-3.5",
}: FileDownloadButtonProps) {
  const fileName = getFileName(filePath);
  const downloadUrl = getFileDownloadUrl(workspaceId, filePath, language);

  if (downloadUrl !== null) {
    return (
      <Button variant="ghost" size={size} className={className} asChild>
        <a
          href={downloadUrl}
          download={fileName}
          aria-label="Download file"
          title="Download file"
        >
          <Download className={iconClassName} />
        </a>
      </Button>
    );
  }

  return (
    <Button
      variant="ghost"
      size={size}
      className={className}
      onClick={() => downloadTextFile(fileName, content)}
      aria-label="Download file"
      title="Download file"
    >
      <Download className={iconClassName} />
    </Button>
  );
}
