"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import {
  LayoutDashboard,
  MessageSquare,
  GitMerge,
  GitBranch,
  Terminal,
  Settings,
} from "lucide-react"
import { useMemo } from "react"
import { cn } from "@/lib/utils"
import { useCommand } from "@/hooks/use-command"

const navItems = [
  { href: "/", label: "Dash", icon: LayoutDashboard },
  { href: "/chat", label: "Chat", icon: MessageSquare },
  { href: "/git", label: "Git", icon: GitMerge },
  { href: "/workspaces", label: "Repos", icon: GitBranch },
  { href: "/settings", label: "Settings", icon: Settings },
]

export function AppSidebar() {
  const pathname = usePathname()
  const router = useRouter()

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
