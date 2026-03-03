"use client"

import { useState, useEffect } from "react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { useWorkspaceStore } from "@/stores/workspace-store"
import {
  useDefaultWorkspaceSetting,
  useWorktreeBaseDirSetting,
  useCloneBaseDirSetting,
  useSettingsMutation,
  SETTINGS_KEYS,
} from "@/hooks/use-settings"

export function WorkspaceSettings() {
  const workspaces = useWorkspaceStore((s) => s.workspaces)
  const { defaultWorkspaceId, isLoading: isLoadingDefault } = useDefaultWorkspaceSetting()
  const { worktreeBaseDir, isLoading: isLoadingWorktree } = useWorktreeBaseDirSetting()
  const { cloneBaseDir, isLoading: isLoadingClone } = useCloneBaseDirSetting()
  const mutation = useSettingsMutation()

  const [localWorktreeDir, setLocalWorktreeDir] = useState("")
  const [localCloneDir, setLocalCloneDir] = useState("")

  const isLoading = isLoadingDefault || isLoadingWorktree || isLoadingClone

  useEffect(() => {
    if (!isLoadingWorktree) setLocalWorktreeDir(worktreeBaseDir)
  }, [worktreeBaseDir, isLoadingWorktree])

  useEffect(() => {
    if (!isLoadingClone) setLocalCloneDir(cloneBaseDir)
  }, [cloneBaseDir, isLoadingClone])

  const handleDefaultWorkspaceChange = (value: string) => {
    const next = value === "__none__" ? null : value
    mutation.mutate(
      { key: SETTINGS_KEYS.DEFAULT_WORKSPACE, value: next },
      { onSuccess: () => toast.success(next ? "Default workspace set" : "Default workspace cleared") }
    )
  }

  const handleWorktreeDirSave = () => {
    mutation.mutate(
      { key: SETTINGS_KEYS.WORKTREE_BASE_DIR, value: localWorktreeDir },
      { onSuccess: () => toast.success("Worktree base directory updated") }
    )
  }

  const handleCloneDirSave = () => {
    mutation.mutate(
      { key: SETTINGS_KEYS.CLONE_BASE_DIR, value: localCloneDir },
      { onSuccess: () => toast.success("Clone base directory updated") }
    )
  }

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Workspace</CardTitle>
        <CardDescription>
          Default workspace and directory preferences.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="default-workspace">Default workspace</Label>
          <p className="text-xs text-muted-foreground">
            Automatically selected when you open the app
          </p>
          <Select
            value={defaultWorkspaceId ?? "__none__"}
            onValueChange={handleDefaultWorkspaceChange}
            disabled={mutation.isPending}
          >
            <SelectTrigger id="default-workspace">
              <SelectValue placeholder="None" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">None</SelectItem>
              {workspaces.map((w) => (
                <SelectItem key={w.id} value={w.id}>
                  {w.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="worktree-base-dir">Worktree base directory</Label>
          <p className="text-xs text-muted-foreground">
            Base path for new worktrees. Leave empty for repo-relative default.
          </p>
          <div className="flex gap-2">
            <Input
              id="worktree-base-dir"
              value={localWorktreeDir}
              onChange={(e) => setLocalWorktreeDir(e.target.value)}
              placeholder="e.g. ~/worktrees/"
            />
            <Button
              size="sm"
              variant="secondary"
              onClick={handleWorktreeDirSave}
              disabled={localWorktreeDir === worktreeBaseDir || mutation.isPending}
            >
              Save
            </Button>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="clone-base-dir">Clone base directory</Label>
          <p className="text-xs text-muted-foreground">
            Default directory for cloning new repositories
          </p>
          <div className="flex gap-2">
            <Input
              id="clone-base-dir"
              value={localCloneDir}
              onChange={(e) => setLocalCloneDir(e.target.value)}
              placeholder="~/dev/"
            />
            <Button
              size="sm"
              variant="secondary"
              onClick={handleCloneDirSave}
              disabled={localCloneDir === cloneBaseDir || mutation.isPending}
            >
              Save
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
