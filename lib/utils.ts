import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function sanitizeBranchName(input: string, strip: "all" | "leading" = "leading"): string {
  let result = input
    .toLowerCase()
    .replace(/[^a-z0-9/.\-\s_]/g, "")   // keep alphanumeric, /, ., -, space, underscore
    .replace(/[\s_]+/g, "-")              // spaces and underscores → hyphens
    .replace(/-{2,}/g, "-")               // collapse repeated hyphens
    .replace(/\/{2,}/g, "/")              // collapse repeated slashes
  result = result.replace(/^[-/]+/, "")   // always strip leading - or /
  if (strip === "all") {
    result = result.replace(/[-/]+$/, "") // strip trailing only on final cleanup
  }
  return result
}

export const WORKSPACE_PRESET_COLORS = [
  "#ef4444", "#f97316", "#eab308", "#22c55e",
  "#06b6d4", "#3b82f6", "#8b5cf6", "#ec4899",
  "#6b7280", "#78716c",
] as const
