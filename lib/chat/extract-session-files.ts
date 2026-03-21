import type { MessageWithParts } from "@/lib/opencode/types";

export type FileAction = "created" | "modified" | "read";

export interface SessionFile {
  path: string;
  name: string;
  action: FileAction;
  count: number;
}

const WRITE_TOOLS = new Set(["write"]);
const EDIT_TOOLS = new Set(["edit", "ast_grep_replace"]);
const READ_TOOLS = new Set(["read", "view"]);

const ACTION_PRIORITY: Record<FileAction, number> = {
  created: 0,
  modified: 1,
  read: 2,
};

function extractFilePath(input: Record<string, unknown>): string | null {
  const raw = input.filePath ?? input.path ?? input.file_path ?? input.file;
  if (typeof raw === "string" && raw.length > 0) return raw;
  return null;
}

function classifyAction(
  tool: string,
  isFirstTouch: boolean,
): FileAction | null {
  if (WRITE_TOOLS.has(tool)) return isFirstTouch ? "created" : "modified";
  if (EDIT_TOOLS.has(tool)) return "modified";
  if (READ_TOOLS.has(tool)) return "read";
  return null;
}

export function extractSessionFiles(
  messages: MessageWithParts[],
): SessionFile[] {
  const fileMap = new Map<
    string,
    { action: FileAction; count: number; order: number }
  >();
  let orderCounter = 0;

  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type !== "tool") continue;

      const filePath = extractFilePath(part.state.input);
      if (!filePath) continue;

      const existing = fileMap.get(filePath);
      const isFirstTouch = !existing;
      const action = classifyAction(part.tool, isFirstTouch);
      if (!action) continue;

      if (existing) {
        existing.count++;
        if (ACTION_PRIORITY[action] < ACTION_PRIORITY[existing.action]) {
          existing.action = action;
        }
        existing.order = orderCounter++;
      } else {
        fileMap.set(filePath, { action, count: 1, order: orderCounter++ });
      }
    }
  }

  const files: SessionFile[] = [];
  for (const [path, entry] of fileMap) {
    const segments = path.split("/");
    files.push({
      path,
      name: segments[segments.length - 1] || path,
      action: entry.action,
      count: entry.count,
    });
  }

  files.sort((a, b) => {
    const aPriority = ACTION_PRIORITY[a.action];
    const bPriority = ACTION_PRIORITY[b.action];
    if (aPriority !== bPriority) return aPriority - bPriority;
    const aOrder = fileMap.get(a.path)!.order;
    const bOrder = fileMap.get(b.path)!.order;
    return bOrder - aOrder;
  });

  return files;
}
