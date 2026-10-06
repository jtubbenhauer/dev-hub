"use client";

import { useState } from "react";
import { ImageOff } from "lucide-react";
import { getRawFileUrl } from "@/lib/file-preview";

interface ImageViewerProps {
  workspaceId: string;
  filePath: string;
}

const TRANSPARENCY_CHECKERBOARD = {
  backgroundImage:
    "repeating-conic-gradient(#80808033 0% 25%, transparent 0% 50%)",
  backgroundSize: "16px 16px",
};

export function ImageViewer({ workspaceId, filePath }: ImageViewerProps) {
  const imageUrl = getRawFileUrl(workspaceId, filePath);
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null);
  const fileName = filePath.split("/").pop() ?? filePath;

  if (failedImageUrl === imageUrl) {
    return (
      <div className="text-muted-foreground flex h-full w-full flex-col items-center justify-center gap-2 p-6 text-center text-sm">
        <ImageOff className="size-8 opacity-40" />
        <p>Could not load image: {fileName}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full items-center justify-center p-4">
      {/* eslint-disable-next-line @next/next/no-img-element -- served by an authenticated API route, so next/image optimization does not apply */}
      <img
        data-testid="image-viewer"
        src={imageUrl}
        alt={fileName}
        style={TRANSPARENCY_CHECKERBOARD}
        className="max-h-full max-w-full object-contain"
        onError={() => setFailedImageUrl(imageUrl)}
      />
    </div>
  );
}
