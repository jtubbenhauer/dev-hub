"use client"

import { useMemo } from "react"
import { AuthenticatedLayout } from "@/components/layout/authenticated-layout"
import { GitPanel } from "@/components/git/git-panel"
import { useWorkspaceStore } from "@/stores/workspace-store"
import { GitBranch } from "lucide-react"

export default function GitPage() {
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId)
  const workspaces = useWorkspaceStore((s) => s.workspaces)
  const activeWorkspace = useMemo(
    () => workspaces.find((w) => w.id === activeWorkspaceId) ?? null,
    [workspaces, activeWorkspaceId]
  )

  return (
    <AuthenticatedLayout>
      {activeWorkspace ? (
        <GitPanel workspace={activeWorkspace} onClose={() => {}} />
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
          <GitBranch className="h-10 w-10 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">
            Select a workspace to view git status
          </p>
        </div>
      )}
    </AuthenticatedLayout>
  )
}
