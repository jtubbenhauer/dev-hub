"use client";

import { signOut } from "next-auth/react";
import { WorkspaceSwitcher } from "@/components/layout/workspace-switcher";
import { GitStatusBar } from "@/components/layout/git-status-bar";
import { SystemIndicator } from "@/components/layout/system-indicator";
import { CommandDrawer } from "@/components/command-runner/command-drawer";
import { TerminalDrawer } from "@/components/terminal/terminal-drawer";
import { ProviderCreationIndicator } from "@/components/workspace/provider-creation-indicator";
import { useCommandPalette } from "@/components/providers/command-palette-provider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useCommandStore } from "@/stores/command-store";
import { LogOut, Terminal, Search } from "lucide-react";

export function Header() {
  const setDrawerOpen = useCommandStore((s) => s.setDrawerOpen);
  const runningCount = useCommandStore(
    (s) =>
      Object.values(s.sessions).filter((session) => session.isRunning).length,
  );
  const { toggle: toggleCommandPalette } = useCommandPalette();

  return (
    <>
      <header className="bg-background sticky top-0 z-40 flex h-12 shrink-0 items-center justify-between border-b px-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 md:hidden">
            <Terminal className="text-primary h-5 w-5" />
            <span className="text-lg font-semibold">Dev Hub</span>
          </div>
          <WorkspaceSwitcher />
          <div className="bg-border hidden h-4 w-px sm:block" />
          <div className="hidden sm:block">
            <GitStatusBar />
          </div>
          <div className="bg-border hidden h-4 w-px lg:block" />
          <div className="hidden lg:block">
            <SystemIndicator />
          </div>
        </div>
        <div className="flex items-center gap-1">
          <ProviderCreationIndicator />
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleCommandPalette}
            title="Command palette (Ctrl+,)"
          >
            <Search className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setDrawerOpen(true)}
            className="relative"
          >
            <Terminal className="h-4 w-4" />
            {runningCount > 0 && (
              <Badge
                variant="default"
                className="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full p-0 text-[10px]"
              >
                {runningCount}
              </Badge>
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => signOut({ callbackUrl: "/login" })}
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>
      <CommandDrawer />
      <TerminalDrawer />
    </>
  );
}
