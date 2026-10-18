"use client";

import { forwardRef } from "react";
import { Download, FileWarning } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  EditorSwitcher,
  type EditorHandle,
} from "@/components/editor/editor-switcher";
import { PdfViewer } from "@/components/editor/pdf-viewer";
import { ImageViewer } from "@/components/editor/image-viewer";
import {
  getFileName,
  getRawFileDownloadUrl,
  getUnsupportedFileMessage,
  IMAGE_LANGUAGE,
  PDF_LANGUAGE,
} from "@/lib/file-preview";

interface FileViewerProps {
  workspaceId: string;
  filePath: string;
  content: string;
  language: string;
  onChange: (content: string) => void;
  onSave?: () => void;
  autoFocus?: boolean;
  isLspEligible?: boolean;
}

interface UnsupportedFileNoticeProps {
  workspaceId: string;
  filePath: string;
  message: string;
}

function UnsupportedFileNotice({
  workspaceId,
  filePath,
  message,
}: UnsupportedFileNoticeProps) {
  return (
    <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm">
      <FileWarning className="size-8" />
      <p>{message}</p>
      <Button size="sm" asChild>
        <a
          href={getRawFileDownloadUrl(workspaceId, filePath)}
          download={getFileName(filePath)}
        >
          <Download className="size-3.5" />
          Download
        </a>
      </Button>
    </div>
  );
}

export const FileViewer = forwardRef<EditorHandle, FileViewerProps>(
  function FileViewer(props, ref) {
    const { workspaceId, filePath, language } = props;

    if (language === PDF_LANGUAGE) {
      return <PdfViewer workspaceId={workspaceId} filePath={filePath} />;
    }
    if (language === IMAGE_LANGUAGE) {
      return <ImageViewer workspaceId={workspaceId} filePath={filePath} />;
    }
    const unsupportedMessage = getUnsupportedFileMessage(language);
    if (unsupportedMessage !== null) {
      return (
        <UnsupportedFileNotice
          workspaceId={workspaceId}
          filePath={filePath}
          message={unsupportedMessage}
        />
      );
    }
    return <EditorSwitcher ref={ref} {...props} />;
  },
);
