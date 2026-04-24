import type { Part } from "@/lib/opencode/types";

export const FILE_MODIFYING_TOOLS = new Set(["write", "edit"]);

export function extractFilePathFromToolPart(part: Part): string | null {
  if (part.type !== "tool") return null;
  if (!FILE_MODIFYING_TOOLS.has(part.tool)) return null;
  if (part.state.status !== "completed") return null;

  const input = part.state.input as Record<string, unknown>;
  const filePath =
    input.filePath ?? input.path ?? input.file_path ?? input.file;

  if (typeof filePath !== "string" || filePath === "") return null;
  return filePath;
}
