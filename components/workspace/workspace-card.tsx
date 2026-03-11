"use client"

import { useState } from "react"
import Link from "next/link"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useWorkspaceStore } from "@/stores/workspace-store"
import { useCommandStore } from "@/stores/command-store"
import { useGitStatus } from "@/hooks/use-git"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  Trash2,
  MessageSquare,
  FolderOpen,
  GitBranch,
  ArrowUp,
  ArrowDown,
  Clock,
  GitCommitHorizontal,
  FileWarning,
  Play,
  Plus,
  X,
  Settings2,
} from "lucide-react"
import { toast } from "sonner"
import type { Workspace, QuickCommand } from "@/types"

interface WorkspaceCardProps {
  workspace: Workspace
  onDelete: (id: string) => void
  isDeleting: boolean
}

export function WorkspaceCard({
  workspace,
  onDelete,
  isDeleting,
}: WorkspaceCardProps) {
  const { setActiveWorkspaceId } = useWorkspaceStore()
  const { data: gitStatus } = useGitStatus(workspace.id)
  const runCommand = useCommandStore((s) => s.runCommand)
  const setDrawerOpen = useCommandStore((s) => s.setDrawerOpen)

  const totalChanges = gitStatus
    ? gitStatus.staged.length + gitStatus.unstaged.length + gitStatus.untracked.length
    : 0

  const relativeDate = gitStatus?.lastCommit?.date
    ? formatRelativeDate(gitStatus.lastCommit.date)
    : null

  const quickCommands = workspace.quickCommands ?? []

  const handleRunQuickCommand = (cmd: QuickCommand) => {
    runCommand(cmd.command, workspace.id)
    setDrawerOpen(true)
  }

  return (
    <Card className="overflow-hidden hover:border-primary/50">
      <CardHeader className="pb-2">
        <div className="flex min-w-0 items-center justify-between">
          <CardTitle className="min-w-0 text-base truncate">{workspace.name}</CardTitle>
          <div className="flex items-center gap-1.5 shrink-0">
            {workspace.backend === "remote" && (
              <Badge variant="outline" className="text-xs border-blue-500/50 text-blue-500">
                remote
              </Badge>
            )}
            <Badge variant="secondary" className="text-xs">
              {workspace.type}
            </Badge>
            {workspace.packageManager && workspace.packageManager !== "none" && (
              <Badge variant="outline" className="text-xs">
                {workspace.packageManager}
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground truncate font-mono">
          {workspace.path}
        </p>

        {gitStatus?.isRepo && (
          <div className="space-y-2">
            {/* Branch + tracking info */}
            <div className="flex items-center gap-2 text-xs">
              <div className="flex items-center gap-1 text-foreground">
                <GitBranch className="size-3.5" />
                <span className="font-medium truncate max-w-32">
                  {gitStatus.branch}
                </span>
              </div>
              {(gitStatus.ahead > 0 || gitStatus.behind > 0) && (
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  {gitStatus.ahead > 0 && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="flex items-center gap-0.5 text-green-500">
                          <ArrowUp className="size-3" />
                          {gitStatus.ahead}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        {gitStatus.ahead} commit{gitStatus.ahead > 1 ? "s" : ""} ahead
                      </TooltipContent>
                    </Tooltip>
                  )}
                  {gitStatus.behind > 0 && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="flex items-center gap-0.5 text-orange-500">
                          <ArrowDown className="size-3" />
                          {gitStatus.behind}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        {gitStatus.behind} commit{gitStatus.behind > 1 ? "s" : ""} behind
                      </TooltipContent>
                    </Tooltip>
                  )}
                </div>
              )}
              {totalChanges > 0 && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="flex items-center gap-0.5 text-yellow-500">
                      <FileWarning className="size-3" />
                      {totalChanges}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    {gitStatus.staged.length} staged, {gitStatus.unstaged.length} modified, {gitStatus.untracked.length} untracked
                  </TooltipContent>
                </Tooltip>
              )}
            </div>

            {/* Last commit */}
            {gitStatus.lastCommit && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <GitCommitHorizontal className="size-3 shrink-0" />
                <span className="truncate flex-1">{gitStatus.lastCommit.message}</span>
                <span className="flex items-center gap-0.5 shrink-0">
                  <Clock className="size-3" />
                  {relativeDate}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Quick commands */}
        {quickCommands.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {quickCommands.map((cmd) => (
              <Tooltip key={cmd.label}>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 gap-1 px-2 text-xs"
                    onClick={(event) => {
                      event.stopPropagation()
                      handleRunQuickCommand(cmd)
                    }}
                  >
                    <Play className="size-2.5" />
                    {cmd.label}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <code className="text-xs">{cmd.command}</code>
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex items-center justify-between">
          <div className="flex gap-2">
            <Link
              href="/chat"
              onClick={(event) => {
                event.stopPropagation()
                setActiveWorkspaceId(workspace.id)
              }}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <MessageSquare className="size-3" />
              Chat
            </Link>
            <Link
              href="/git"
              onClick={(event) => {
                event.stopPropagation()
                setActiveWorkspaceId(workspace.id)
              }}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <FolderOpen className="size-3" />
              Git
            </Link>
          </div>
          <div className="flex items-center gap-1">
            <QuickCommandsEditor workspace={workspace} />
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={(event) => {
                event.stopPropagation()
                onDelete(workspace.id)
              }}
              disabled={isDeleting}
              className="text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function QuickCommandsEditor({ workspace }: { workspace: Workspace }) {
  const queryClient = useQueryClient()
  const [commands, setCommands] = useState<QuickCommand[]>(workspace.quickCommands ?? [])
  const [newLabel, setNewLabel] = useState("")
  const [newCommand, setNewCommand] = useState("")
  const [isOpen, setIsOpen] = useState(false)

  const saveMutation = useMutation({
    mutationFn: async (quickCommands: QuickCommand[]) => {
      const res = await fetch(`/api/workspaces/${workspace.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quickCommands }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || "Failed to save")
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspaces"] })
      toast.success("Quick commands saved")
    },
    onError: (err: Error) => {
      toast.error(err.message)
    },
  })

  const handleAdd = () => {
    const label = newLabel.trim()
    const command = newCommand.trim()
    if (!label || !command) return

    const updated = [...commands, { label, command }]
    setCommands(updated)
    setNewLabel("")
    setNewCommand("")
    saveMutation.mutate(updated)
  }

  const handleRemove = (index: number) => {
    const updated = commands.filter((_, i) => i !== index)
    setCommands(updated)
    saveMutation.mutate(updated)
  }

  return (
    <Popover open={isOpen} onOpenChange={(open) => {
      setIsOpen(open)
      if (open) setCommands(workspace.quickCommands ?? [])
    }}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground hover:text-foreground"
          onClick={(event) => event.stopPropagation()}
        >
          <Settings2 className="size-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-80"
        align="end"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="space-y-3">
          <p className="text-sm font-medium">Quick Commands</p>

          {commands.length > 0 && (
            <div className="space-y-1.5">
              {commands.map((cmd, index) => (
                <div key={index} className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">{cmd.label}</p>
                    <p className="text-xs text-muted-foreground truncate font-mono">
                      {cmd.command}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() => handleRemove(index)}
                    disabled={saveMutation.isPending}
                  >
                    <X className="size-3" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          <div className="space-y-2 border-t pt-3">
            <Input
              placeholder="Label (e.g. Dev)"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              className="h-7 text-xs"
            />
            <Input
              placeholder="Command (e.g. pnpm dev)"
              value={newCommand}
              onChange={(e) => setNewCommand(e.target.value)}
              className="h-7 text-xs font-mono"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAdd()
              }}
            />
            <Button
              size="sm"
              className="w-full h-7 text-xs"
              onClick={handleAdd}
              disabled={!newLabel.trim() || !newCommand.trim() || saveMutation.isPending}
            >
              <Plus className="size-3 mr-1" />
              Add Command
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function formatRelativeDate(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMinutes = Math.floor(diffMs / 60_000)
  const diffHours = Math.floor(diffMs / 3_600_000)
  const diffDays = Math.floor(diffMs / 86_400_000)

  if (diffMinutes < 1) return "just now"
  if (diffMinutes < 60) return `${diffMinutes}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 30) return `${diffDays}d ago`
  return date.toLocaleDateString()
}
