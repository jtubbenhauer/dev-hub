"use client"

import { useWorkspaceStore } from "@/stores/workspace-store"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { FolderGit2 } from "lucide-react"

export function WorkspaceSwitcher() {
  const { workspaces, activeWorkspaceId, isLoadingWorkspaces, setActiveWorkspaceId } =
    useWorkspaceStore()

  if (isLoadingWorkspaces) {
    return <Skeleton className="h-9 w-36 sm:w-48" />
  }

  if (workspaces.length === 0) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <FolderGit2 className="h-4 w-4" />
        <span>No workspaces</span>
      </div>
    )
  }

  return (
    <Select
      value={activeWorkspaceId ?? undefined}
      onValueChange={setActiveWorkspaceId}
    >
      <SelectTrigger className="w-36 sm:w-48">
        <FolderGit2 className="mr-2 h-4 w-4" />
        <SelectValue placeholder="Select workspace" />
      </SelectTrigger>
      <SelectContent>
        {workspaces.map((workspace) => (
          <SelectItem key={workspace.id} value={workspace.id}>
            {workspace.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
