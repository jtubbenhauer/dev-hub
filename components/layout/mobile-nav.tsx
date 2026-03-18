"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
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
import { cn } from "@/lib/utils"
import { useKeyboardVisible } from "@/hooks/use-keyboard-visible"

const mobileNavItems = [
  { href: "/", label: "Dash", icon: LayoutDashboard },
  { href: "/chat", label: "Chat", icon: MessageSquare },
  { href: "/files", label: "Files", icon: FileCode2 },
  { href: "/git", label: "Git", icon: GitMerge },
  { href: "/terminal", label: "Term", icon: Terminal },
  { href: "/tasks", label: "Tasks", icon: CheckSquare },
  { href: "/workspaces", label: "Repos", icon: GitBranch },
  { href: "/settings", label: "Settings", icon: Settings },
]

export function MobileNav() {
  const pathname = usePathname()
  const isKeyboardVisible = useKeyboardVisible()

  if (isKeyboardVisible) return null

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 flex h-16 items-center justify-around border-t bg-background md:hidden">
      {mobileNavItems.map((item) => {
        const isActive =
          item.href === "/"
            ? pathname === "/"
            : pathname.startsWith(item.href)

        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex flex-col items-center gap-1 px-1 py-1 text-[10px] transition-colors",
              isActive
                ? "text-primary"
                : "text-muted-foreground"
            )}
          >
            <item.icon className="h-5 w-5" />
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
