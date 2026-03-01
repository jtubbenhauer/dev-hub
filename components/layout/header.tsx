"use client"

import { signOut } from "next-auth/react"
import { WorkspaceSwitcher } from "@/components/layout/workspace-switcher"
import { GitStatusBar } from "@/components/layout/git-status-bar"
import { SystemIndicator } from "@/components/layout/system-indicator"
import { Button } from "@/components/ui/button"
import { LogOut, Terminal } from "lucide-react"

export function Header() {
  return (
    <header className="flex h-14 items-center justify-between border-b px-4">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 md:hidden">
          <Terminal className="h-5 w-5 text-primary" />
          <span className="text-lg font-semibold">Dev Hub</span>
        </div>
        <WorkspaceSwitcher />
        <div className="hidden sm:block h-4 w-px bg-border" />
        <div className="hidden sm:block">
          <GitStatusBar />
        </div>
        <div className="hidden lg:block h-4 w-px bg-border" />
        <div className="hidden lg:block">
          <SystemIndicator />
        </div>
      </div>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => signOut({ callbackUrl: "/login" })}
      >
        <LogOut className="h-4 w-4" />
      </Button>
    </header>
  )
}
