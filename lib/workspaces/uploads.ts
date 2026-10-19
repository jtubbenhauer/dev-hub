import { randomUUID } from "node:crypto";
import type { WorkspaceBackend } from "@/lib/workspaces/backend";

export const WORKSPACE_UPLOADS_DIR = ".devhub/uploads";

const MAX_UPLOAD_FILENAME_LENGTH = 100;

function sanitizeUploadFilename(filename: string): string {
  const baseName = filename.split(/[\\/]/).pop() ?? "";
  const safeName = baseName
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .slice(-MAX_UPLOAD_FILENAME_LENGTH)
    .replace(/^[.-]+/, "");
  return safeName || "attachment";
}

function formatUploadTimestamp(date: Date): string {
  return date.toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-");
}

// The .gitignore keeps uploads out of git status, reviews and commits.
export async function saveWorkspaceUpload(
  backend: Pick<WorkspaceBackend, "writeFile">,
  filename: string,
  content: string,
): Promise<string> {
  const uploadPath = `${WORKSPACE_UPLOADS_DIR}/${formatUploadTimestamp(new Date())}-${randomUUID().slice(0, 6)}-${sanitizeUploadFilename(filename)}`;
  await backend.writeFile(`${WORKSPACE_UPLOADS_DIR}/.gitignore`, "*\n");
  await backend.writeFile(uploadPath, content);
  return uploadPath;
}
