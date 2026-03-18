"use client"

import { SessionProvider } from "next-auth/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useState } from "react"
import { TooltipProvider } from "@/components/ui/tooltip"
import { Toaster } from "@/components/ui/sonner"
import { ThemeProvider } from "@/components/providers/theme-provider"
import { CommandPaletteProvider } from "@/components/providers/command-palette-provider"
import { CommandPalette } from "@/components/command-palette/command-palette"
import { FilePickerProvider, FilePickerDialog } from "@/components/file-picker/file-picker"
import { SessionPickerProvider, SessionPickerDialog } from "@/components/session-picker/session-picker"
import { LeaderKeyProvider } from "@/components/providers/leader-key-provider"
import { WhichKeyPanel } from "@/components/leader-key/which-key-panel"
import { useLeaderKeyBindings, useLeaderWhichKeySetting, useLeaderTimeoutSetting } from "@/hooks/use-settings"

// Reads bindings from the DB and passes them to the provider.
// Must be inside QueryClientProvider so the settings hooks work.
function LeaderKeySetup({ children }: { children: React.ReactNode }) {
  const { bindings } = useLeaderKeyBindings()
  const { isWhichKeyEnabled } = useLeaderWhichKeySetting()
  const { leaderTimeout } = useLeaderTimeoutSetting()
  const timeoutMs = leaderTimeout === null ? null : leaderTimeout * 1000

  return (
    <LeaderKeyProvider bindings={bindings} timeoutMs={timeoutMs}>
      {children}
      {isWhichKeyEnabled && <WhichKeyPanel />}
    </LeaderKeyProvider>
  )
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30 * 1000,
            retry: 1,
          },
        },
      })
  )

  return (
    <SessionProvider>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <TooltipProvider>
            <CommandPaletteProvider>
              <FilePickerProvider>
                <SessionPickerProvider>
                  <LeaderKeySetup>
                    {children}
                    <CommandPalette />
                    <FilePickerDialog />
                    <SessionPickerDialog />
                    <Toaster />
                  </LeaderKeySetup>
                </SessionPickerProvider>
              </FilePickerProvider>
            </CommandPaletteProvider>
          </TooltipProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </SessionProvider>
  )
}
