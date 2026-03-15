"use client"

import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { useEffect } from "react"
import { useQuery } from "@tanstack/react-query"
import { AppSidebar } from "@/components/layout/app-sidebar"
import { MobileNav } from "@/components/layout/mobile-nav"
import { Header } from "@/components/layout/header"
import { WorkspaceCommands } from "@/components/command-palette/workspace-commands"
import { SoundSettingsSync } from "@/components/providers/sound-settings-sync"
import { useWorkspaceStore } from "@/stores/workspace-store"
import { useChatStore } from "@/stores/chat-store"
import { useDefaultWorkspaceSetting } from "@/hooks/use-settings"
import type { Workspace } from "@/types"
import { useKeyboardVisible } from "@/hooks/use-keyboard-visible"
import { cn } from "@/lib/utils"

export function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { status } = useSession()
  const router = useRouter()
  const { setWorkspaces, setIsLoadingWorkspaces, activeWorkspaceId, setActiveWorkspaceId } =
    useWorkspaceStore()
  const { defaultWorkspaceId } = useDefaultWorkspaceSetting()
  const connectSSE = useChatStore((s) => s.connectSSE)
  const disconnectAllSSE = useChatStore((s) => s.disconnectAllSSE)
  const handleVisibilityRestored = useChatStore((s) => s.handleVisibilityRestored)
  const isKeyboardVisible = useKeyboardVisible()

  const { data, isFetching } = useQuery<Workspace[]>({
    queryKey: ["workspaces"],
    queryFn: async () => {
      const res = await fetch("/api/workspaces")
      if (!res.ok) throw new Error("Failed to fetch workspaces")
      return res.json()
    },
    staleTime: 60_000,
    enabled: status === "authenticated",
  })

  useEffect(() => {
    setIsLoadingWorkspaces(isFetching && !data)
  }, [isFetching, data, setIsLoadingWorkspaces])

  useEffect(() => {
    if (!data) return
    setWorkspaces(data)
    if (!activeWorkspaceId && data.length > 0) {
      const preferred = defaultWorkspaceId && data.some((w) => w.id === defaultWorkspaceId)
        ? defaultWorkspaceId
        : data[0].id
      setActiveWorkspaceId(preferred)
    }
    // Open SSE connections for all workspaces so activity is visible globally
    for (const workspace of data) {
      connectSSE(workspace.id)
    }
  }, [data, activeWorkspaceId, defaultWorkspaceId, setWorkspaces, setActiveWorkspaceId, connectSSE])

  // Clean up all SSE connections when the layout unmounts (page close / sign-out)
  useEffect(() => {
    return () => disconnectAllSSE()
  }, [disconnectAllSSE])

  // When the user returns to this tab, flush any part updates that were buffered
  // while the tab was hidden (browsers suspend requestAnimationFrame in background
  // tabs, so the normal RAF flush never fires), and verify SSE health.
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        handleVisibilityRestored()
      }
    }
    document.addEventListener("visibilitychange", handleVisibilityChange)
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange)
  }, [handleVisibilityRestored])

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login")
    }
  }, [status, router])

  if (status === "loading") {
    return (
      <div className="flex h-dvh items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    )
  }

  if (status === "unauthenticated") return null

  return (
    <div className="flex h-dvh">
      <AppSidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header />
        <main className={cn("flex min-w-0 flex-1 flex-col overflow-hidden", !isKeyboardVisible && "pb-16 md:pb-0")}>{children}</main>
      </div>
      <MobileNav />
      <WorkspaceCommands />
      <SoundSettingsSync />
    </div>
  )
}
