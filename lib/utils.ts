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

export function isEditorElement(el: Element | null): boolean {
  if (!el) return false
  return el.closest(".monaco-editor, .monaco-diff-editor, .xterm") !== null
}

export function getIsMac(): boolean {
  if (typeof navigator === "undefined") return false
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const uad = navigator as any
  if (uad.userAgentData?.platform) return uad.userAgentData.platform === "macOS"
  return /Mac/.test(navigator.platform ?? "")
}

export const WORKSPACE_PRESET_COLORS = [
  "#ef4444", "#f97316", "#eab308", "#22c55e",
  "#06b6d4", "#3b82f6", "#8b5cf6", "#ec4899",
  "#6b7280", "#78716c",
] as const
