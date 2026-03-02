"use client"

import { useState, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { GitFork, FolderGit2, Loader2, Plus } from "lucide-react"
import { useCreateWorktree } from "@/hooks/use-git"
import { useWorkspaceStore } from "@/stores/workspace-store"
import type { ClickUpTask } from "@/types"

interface TaskWorktreeDialogProps {
  task: ClickUpTask
  open: boolean
  onOpenChange: (open: boolean) => void
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60)
}

export function TaskWorktreeDialog({ task, open, onOpenChange }: TaskWorktreeDialogProps) {
  const workspaces = useWorkspaceStore((s) => s.workspaces)
  const repoWorkspaces = useMemo(
    () => workspaces.filter((w) => w.type === "repo"),
    [workspaces]
  )

  const defaultBranch = useMemo(() => slugify(task.name), [task.name])

  const [selectedRepoId, setSelectedRepoId] = useState<string | null>(null)
  const [branchName, setBranchName] = useState(defaultBranch)
  const [customName, setCustomName] = useState("")

  const createWorktree = useCreateWorktree()

  const selectedRepo = useMemo(
    () => repoWorkspaces.find((w) => w.id === selectedRepoId) ?? null,
    [repoWorkspaces, selectedRepoId]
  )

  const targetPath = useMemo(() => {
    if (!selectedRepo || !branchName) return ""
    return `${selectedRepo.path}-worktrees/${branchName}`
  }, [selectedRepo, branchName])

  const workspaceName = useMemo(() => {
    if (customName) return customName
    if (!selectedRepo || !branchName) return ""
    const parentName =
      selectedRepo.path.split("/").filter(Boolean).pop() ?? selectedRepo.name
    return `${parentName}/${branchName}`
  }, [selectedRepo, branchName, customName])

  function handleCreate() {
    if (!selectedRepo || !branchName) return

    createWorktree.mutate(
      {
        parentRepoPath: selectedRepo.path,
        branch: branchName,
        newBranch: true,
        name: customName || undefined,
      },
      {
        onSuccess: () => {
          onOpenChange(false)
          resetState()
        },
      }
    )
  }

  function resetState() {
    setSelectedRepoId(null)
    setBranchName(defaultBranch)
    setCustomName("")
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        onOpenChange(isOpen)
        if (!isOpen) resetState()
      }}
    >
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitFork className="h-4 w-4" />
            Create Worktree from Task
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Task info */}
          <div className="rounded-md border bg-muted/30 px-3 py-2">
            <div className="text-sm font-medium truncate">{task.name}</div>
            <div className="flex items-center gap-2 mt-1">
              <Badge
                variant="secondary"
                className="text-xs py-0 px-1.5"
                style={{ color: task.status.color }}
              >
                {task.status.status}
              </Badge>
              {task.custom_id && (
                <span className="text-xs text-muted-foreground font-mono">
                  {task.custom_id}
                </span>
              )}
              <span className="text-xs text-muted-foreground">
                {task.list.name}
              </span>
            </div>
          </div>

          {/* Repo selector */}
          <div className="space-y-2">
            <Label>Parent Repository</Label>
            {repoWorkspaces.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-4 text-center">
                <FolderGit2 className="h-8 w-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  No repositories registered. Add a repo workspace first.
                </p>
              </div>
            ) : (
              <ScrollArea className="max-h-[200px]">
                <div className="space-y-1.5 pr-4">
                  {repoWorkspaces.map((repo) => (
                    <button
                      key={repo.id}
                      onClick={() => setSelectedRepoId(repo.id)}
                      className={`flex w-full items-center gap-2.5 rounded-lg border p-2.5 text-left transition-colors hover:bg-accent ${
                        selectedRepoId === repo.id
                          ? "border-primary bg-accent"
                          : ""
                      }`}
                    >
                      <FolderGit2 className="h-4 w-4 shrink-0 text-orange-500" />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium">{repo.name}</div>
                        <div className="truncate text-xs text-muted-foreground font-mono">
                          {repo.path}
                        </div>
                      </div>
                      {repo.packageManager && repo.packageManager !== "none" && (
                        <Badge variant="secondary" className="text-xs shrink-0">
                          {repo.packageManager}
                        </Badge>
                      )}
                    </button>
                  ))}
                </div>
              </ScrollArea>
            )}
          </div>

          {/* Branch name */}
          <div className="space-y-2">
            <Label htmlFor="task-branch-name">Branch name</Label>
            <Input
              id="task-branch-name"
              value={branchName}
              onChange={(e) => setBranchName(e.target.value)}
              placeholder={defaultBranch}
              className="font-mono text-sm"
            />
          </div>

          {/* Custom display name */}
          <div className="space-y-2">
            <Label htmlFor="task-custom-name" className="text-xs text-muted-foreground">
              Display name (optional)
            </Label>
            <Input
              id="task-custom-name"
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              placeholder={workspaceName || "auto-generated"}
              className="text-sm"
            />
          </div>

          {/* Preview */}
          {selectedRepo && branchName && (
            <div className="space-y-1.5 rounded-md border bg-muted/30 px-3 py-2">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <GitFork className="h-3 w-3" />
                <span>Will create:</span>
              </div>
              <div className="font-mono text-xs break-all">{targetPath}</div>
              <div className="text-xs text-muted-foreground">
                as <span className="font-medium text-foreground">{workspaceName}</span>
              </div>
            </div>
          )}

          {/* Create button */}
          <Button
            onClick={handleCreate}
            disabled={createWorktree.isPending || !selectedRepo || !branchName}
            className="w-full"
          >
            {createWorktree.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Creating...
              </>
            ) : (
              <>
                <Plus className="mr-2 h-4 w-4" />
                Create Worktree
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
