"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import {
  LayoutDashboard,
  MessageSquare,
  FileCode2,
  GitMerge,
  GitBranch,
  Terminal,
  Settings,
  CheckSquare,
} from "lucide-react"
import { useMemo, useRef } from "react"
import { cn } from "@/lib/utils"
import { useCommand } from "@/hooks/use-command"
import { useLeaderAction } from "@/hooks/use-leader-action"
import { useCommandPalette } from "@/components/providers/command-palette-provider"
import { useFilePicker } from "@/components/file-picker/file-picker"

const navItems = [
  { href: "/", label: "Dash", icon: LayoutDashboard },
  { href: "/chat", label: "Chat", icon: MessageSquare },
  { href: "/files", label: "Files", icon: FileCode2 },
  { href: "/git", label: "Git", icon: GitMerge },
  { href: "/tasks", label: "Tasks", icon: CheckSquare },
  { href: "/workspaces", label: "Repos", icon: GitBranch },
  { href: "/settings", label: "Settings", icon: Settings },
]

export function AppSidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const { open: openCommandPalette } = useCommandPalette()
  const { open: openFilePicker } = useFilePicker()

  const navCommands = useMemo(
    () =>
      navItems.map((item) => ({
        id: `nav:${item.href}`,
        label: `Go to ${item.label}`,
        group: "Navigation",
        icon: item.icon,
        onSelect: () => router.push(item.href),
      })),
    // router is stable; navItems is module-level constant
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  useCommand(navCommands)

  // Stable refs so the leader action useMemo stays stable
  const routerRef = useRef(router)
  routerRef.current = router
  const openCommandPaletteRef = useRef(openCommandPalette)
  openCommandPaletteRef.current = openCommandPalette
  const openFilePickerRef = useRef(openFilePicker)
  openFilePickerRef.current = openFilePicker

  const globalLeaderActions = useMemo(
    () => [
      {
        action: { id: "nav:chat", label: "Go to Chat", page: "global" as const },
        handler: () => routerRef.current.push("/chat"),
      },
      {
        action: { id: "nav:files", label: "Go to Files", page: "global" as const },
        handler: () => routerRef.current.push("/files"),
      },
      {
        action: { id: "nav:git", label: "Go to Git", page: "global" as const },
        handler: () => routerRef.current.push("/git"),
      },
      {
        action: { id: "nav:tasks", label: "Go to Tasks", page: "global" as const },
        handler: () => routerRef.current.push("/tasks"),
      },
      {
        action: { id: "nav:dashboard", label: "Go to Dashboard", page: "global" as const },
        handler: () => routerRef.current.push("/"),
      },
      {
        action: { id: "nav:repos", label: "Go to Repos", page: "global" as const },
        handler: () => routerRef.current.push("/workspaces"),
      },
      {
        action: { id: "nav:settings", label: "Go to Settings", page: "global" as const },
        handler: () => routerRef.current.push("/settings"),
      },
      {
        action: { id: "global:command-palette", label: "Open command palette", page: "global" as const },
        handler: () => openCommandPaletteRef.current(),
      },
      {
        action: { id: "global:file-picker", label: "Open file picker", page: "global" as const },
        handler: () => openFilePickerRef.current(),
      },
    ],
    []
  )

  useLeaderAction(globalLeaderActions)

  return (
    <aside className="hidden md:flex h-screen w-16 flex-col border-r bg-sidebar">
      <div className="flex h-12 items-center justify-center border-b">
        <Terminal className="h-5 w-5 text-sidebar-primary" />
      </div>
      <nav className="flex flex-1 flex-col gap-1 p-2">
        {navItems.map((item) => {
          const isActive =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href)

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex flex-col items-center gap-0.5 rounded-md py-2 text-[10px] font-medium transition-colors",
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              )}
            >
              <item.icon className="h-5 w-5" />
              {item.label}
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}
