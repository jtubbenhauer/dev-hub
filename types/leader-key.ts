import type { LucideIcon } from "lucide-react"

export interface LeaderAction {
  id: string
  label: string
  description?: string
  page: string | "global"
  icon?: LucideIcon
}

export interface LeaderBinding {
  actionId: string
  keys: string // space-separated, e.g. "r n"
}

// actionId -> keys (space-separated)
export type LeaderBindingsMap = Record<string, string>
