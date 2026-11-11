"use client";

import { WorkspaceSwitcher } from "@/components/layout/workspace-switcher";
import { LayoutSlotHost } from "@/components/layout/layout-slots";
import { GitStatusBar } from "@/components/layout/git-status-bar";
import { SystemIndicator } from "@/components/layout/system-indicator";
import { CommandDrawer } from "@/components/command-runner/command-drawer";
import { TerminalDrawer } from "@/components/terminal/terminal-drawer";
import { TerminalToggleButton } from "@/components/terminal/terminal-toggle-button";
import { ProviderCreationIndicator } from "@/components/workspace/provider-creation-indicator";
import { useCommandPalette } from "@/components/providers/command-palette-provider";
import { useSidebar } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useCommandStore } from "@/stores/command-store";
import { Terminal, Search, PanelLeftOpen, PanelLeftClose } from "lucide-react";

export function Header() {
  const { toggleSidebar, open: sidebarOpen } = useSidebar();
  const setDrawerOpen = useCommandStore((s) => s.setDrawerOpen);
  const runningCount = useCommandStore(
    (s) =>
      Object.values(s.sessions).filter((session) => session.isRunning).length,
  );
  const { toggle: toggleCommandPalette } = useCommandPalette();

  return (
    <>
      <header className="bg-background @container sticky top-0 z-40 flex h-12 shrink-0 items-center border-b px-4 md:pr-2">
        <div className="flex items-center gap-3">
          <Button
            data-sidebar="trigger"
            variant="ghost"
            size="icon"
            className="hidden size-7 md:inline-flex"
            onClick={toggleSidebar}
          >
            {sidebarOpen ? (
              <PanelLeftClose className="text-accent-foreground h-5 w-5" />
            ) : (
              <PanelLeftOpen className="text-accent-foreground h-5 w-5" />
            )}
          </Button>
          <div className="flex items-center gap-2 md:hidden">
            <Terminal className="text-primary h-5 w-5" />
            <span className="text-lg font-semibold">Dev Hub</span>
          </div>
          <WorkspaceSwitcher />
          <div className="bg-border hidden h-4 w-px sm:@xl:block" />
          <div className="hidden sm:@xl:block">
            <GitStatusBar />
          </div>
          <div className="bg-border hidden h-4 w-px lg:@3xl:block" />
          <div className="hidden lg:@3xl:block">
            <SystemIndicator />
          </div>
        </div>
        <div className="flex min-w-0 flex-1 items-center justify-end gap-1">
          <ProviderCreationIndicator />
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleCommandPalette}
            title="Command palette (Cmd+Shift+P / Ctrl+Shift+P)"
          >
            <Search className="h-4 w-4" />
          </Button>
          <TerminalToggleButton />
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
        </div>
        <LayoutSlotHost
          slot="header-trailing"
          className="flex shrink-0 items-center"
        />
      </header>
      <CommandDrawer />
      <TerminalDrawer />
    </>
  );
}
