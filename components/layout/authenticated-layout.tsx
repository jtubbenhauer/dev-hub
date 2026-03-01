"use client"

import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { useEffect } from "react"
import { useQuery } from "@tanstack/react-query"
import { AppSidebar } from "@/components/layout/app-sidebar"
import { MobileNav } from "@/components/layout/mobile-nav"
import { Header } from "@/components/layout/header"
import { useWorkspaceStore } from "@/stores/workspace-store"
import type { Workspace } from "@/types"

export function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { status } = useSession()
  const router = useRouter()
  const { setWorkspaces, setIsLoadingWorkspaces, activeWorkspaceId, setActiveWorkspaceId } =
    useWorkspaceStore()

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
      setActiveWorkspaceId(data[0].id)
    }
  }, [data, activeWorkspaceId, setWorkspaces, setActiveWorkspaceId])

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
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden pb-16 md:pb-0">{children}</main>
      </div>
      <MobileNav />
    </div>
  )
}
