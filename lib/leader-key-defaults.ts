import type { LeaderAction, LeaderBindingsMap } from "@/types/leader-key"

// All built-in actions. Handlers are registered at runtime by page components.
export const BUILTIN_ACTIONS: LeaderAction[] = [
  // Global navigation
  { id: "nav:chat", label: "Go to Chat", page: "global" },
  { id: "nav:git", label: "Go to Git", page: "global" },
  { id: "nav:dashboard", label: "Go to Dashboard", page: "global" },
  { id: "nav:repos", label: "Go to Repos", page: "global" },
  { id: "nav:settings", label: "Go to Settings", page: "global" },
  { id: "global:command-palette", label: "Open command palette", page: "global" },
  { id: "global:switch-workspace", label: "Open workspace switcher", page: "global" },

  // Chat page
  { id: "chat:switch-model", label: "Switch model", page: "chat" },
  { id: "chat:switch-agent", label: "Switch agent", page: "chat" },
  { id: "chat:new-session", label: "New session", page: "chat" },
  { id: "chat:toggle-sessions", label: "Toggle session list", page: "chat" },
  { id: "chat:toggle-plan", label: "Toggle plan panel", page: "chat" },

  // Git page
  { id: "git:toggle-reviewed", label: "Toggle file reviewed", page: "git" },
  { id: "git:reviewed-next", label: "Mark reviewed & next file", page: "git" },
  { id: "git:stage-toggle", label: "Stage/unstage current file", page: "git" },
  { id: "git:stage-all", label: "Stage all files", page: "git" },
  { id: "git:unstage-all", label: "Unstage all files", page: "git" },
  { id: "git:focus-commit", label: "Focus commit message", page: "git" },
  { id: "git:commit", label: "Commit staged files", page: "git" },
  { id: "git:fetch", label: "Fetch from remote", page: "git" },
  { id: "git:pull", label: "Pull from remote", page: "git" },
  { id: "git:push", label: "Push to remote", page: "git" },
  { id: "git:next-file", label: "Select next file", page: "git" },
  { id: "git:prev-file", label: "Select previous file", page: "git" },
  { id: "git:next-unreviewed", label: "Jump to next unreviewed", page: "git" },
  { id: "git:prev-unreviewed", label: "Jump to prev unreviewed", page: "git" },
]

export const DEFAULT_LEADER_BINDINGS: LeaderBindingsMap = {
  // Global navigation
  "nav:chat": "g c",
  "nav:git": "g g",
  "nav:dashboard": "g d",
  "nav:repos": "g r",
  "nav:settings": "g s",
  "global:command-palette": ",",
  "global:switch-workspace": "w",

  // Chat page
  "chat:switch-model": "m",
  "chat:switch-agent": "a",
  "chat:new-session": "n",
  "chat:toggle-sessions": "s",
  "chat:toggle-plan": "p",

  // Git page
  "git:toggle-reviewed": "r",
  "git:reviewed-next": "r n",
  "git:stage-toggle": "s",
  "git:stage-all": "s a",
  "git:unstage-all": "u a",
  "git:focus-commit": "c",
  "git:commit": "c c",
  "git:fetch": "f",
  "git:pull": "p",
  "git:push": "P",
  "git:next-file": "j",
  "git:prev-file": "k",
  "git:next-unreviewed": "]",
  "git:prev-unreviewed": "[",
}
