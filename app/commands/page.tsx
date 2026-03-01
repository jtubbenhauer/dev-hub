"use client"

import { useState, useCallback } from "react"
import { Plus } from "lucide-react"
import { AuthenticatedLayout } from "@/components/layout/authenticated-layout"
import { CommandPanel } from "@/components/command-runner/command-panel"
import { Button } from "@/components/ui/button"
import { useWorkspaceStore } from "@/stores/workspace-store"

export default function CommandsPage() {
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId)
  const [panelIds, setPanelIds] = useState<string[]>(() => [crypto.randomUUID()])

  const addPanel = useCallback(() => {
    setPanelIds((ids) => [...ids, crypto.randomUUID()])
  }, [])

  const removePanel = useCallback((id: string) => {
    setPanelIds((ids) => {
      const next = ids.filter((i) => i !== id)
      // Always keep at least one panel
      return next.length > 0 ? next : [crypto.randomUUID()]
    })
  }, [])

  return (
    <AuthenticatedLayout>
      <div className="flex h-full flex-col gap-3 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold">Command Runner</h1>
            {!activeWorkspaceId && (
              <p className="text-xs text-muted-foreground">
                Select a workspace from the sidebar to run commands in its directory
              </p>
            )}
          </div>
          <Button size="sm" variant="outline" onClick={addPanel} className="gap-1.5">
            <Plus className="size-4" />
            New panel
          </Button>
        </div>

        <div className="flex flex-1 flex-col gap-3 overflow-auto">
          {panelIds.map((id) => (
            <CommandPanel
              key={id}
              workspaceId={activeWorkspaceId}
              onClose={panelIds.length > 1 ? () => removePanel(id) : undefined}
            />
          ))}
        </div>
      </div>
    </AuthenticatedLayout>
  )
}
