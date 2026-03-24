"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useCommandStore } from "@/stores/command-store";
import { useGitStatus, useAgentHealth } from "@/hooks/use-git";
import { useWorkspaceResume } from "@/hooks/use-workspace-resume";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
  Pencil,
  CheckSquare,
  TerminalSquare,
  Loader2,
  Link2,
  MoreHorizontal,
} from "lucide-react";
import { toast } from "sonner";
import { cn, WORKSPACE_PRESET_COLORS } from "@/lib/utils";
import { TaskPicker } from "@/components/task-picker/task-picker";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type {
  ClickUpTask,
  Workspace,
  QuickCommand,
  LinkedTaskMeta,
} from "@/types";

interface WorkspaceCardProps {
  workspace: Workspace;
  onDelete: (id: string, destroyProvider?: boolean) => void;
  isDeleting: boolean;
}

export function WorkspaceCard({
  workspace,
  onDelete,
  isDeleting,
}: WorkspaceCardProps) {
  const { setActiveWorkspaceId } = useWorkspaceStore();
  const { data: gitStatus } = useGitStatus(workspace.id);
  const { data: healthStatus } = useAgentHealth(
    workspace.id,
    workspace.backend === "remote",
  );
  const { isResuming, resume } = useWorkspaceResume(
    workspace.backend === "remote" ? workspace.id : null,
  );
  const runCommand = useCommandStore((s) => s.runCommand);
  const setDrawerOpen = useCommandStore((s) => s.setDrawerOpen);

  const totalChanges = gitStatus
    ? gitStatus.staged.length +
      gitStatus.unstaged.length +
      gitStatus.untracked.length
    : 0;

  const relativeDate = gitStatus?.lastCommit?.date
    ? formatRelativeDate(gitStatus.lastCommit.date)
    : null;

  const hasProvider =
    workspace.backend === "remote" &&
    workspace.providerMeta &&
    typeof (workspace.providerMeta as Record<string, unknown>).providerId ===
      "string";

  const quickCommands = workspace.quickCommands ?? [];

  const handleRunQuickCommand = (cmd: QuickCommand) => {
    runCommand(cmd.command, workspace.id);
    setDrawerOpen(true);
  };

  return (
    <Card className="hover:border-primary/50 overflow-hidden">
      <CardHeader className="pb-2">
        <div className="flex min-w-0 items-center justify-between">
          <div className="flex min-w-0 items-center gap-2">
            <WorkspaceColorPicker workspace={workspace} />
            <EditableWorkspaceName workspace={workspace} />
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {workspace.backend === "remote" && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge
                    variant="outline"
                    className="gap-1 border-blue-500/50 text-xs text-blue-500"
                  >
                    {isResuming ? (
                      <Loader2 className="size-3 animate-spin text-blue-500" />
                    ) : (
                      <span
                        className={cn(
                          "size-1.5 rounded-full",
                          healthStatus === "healthy" && "bg-emerald-500",
                          healthStatus === "suspended" && "bg-amber-500",
                          healthStatus === "unreachable" && "bg-red-500",
                          !healthStatus && "bg-muted-foreground/50",
                        )}
                      />
                    )}
                    {isResuming
                      ? "resuming"
                      : healthStatus === "suspended"
                        ? "suspended"
                        : "remote"}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>
                  {isResuming && "Workspace is starting up..."}
                  {!isResuming &&
                    healthStatus === "suspended" &&
                    "Workspace is suspended. Click Chat/Git/Terminal to resume."}
                  {!isResuming &&
                    healthStatus === "healthy" &&
                    "Agent is reachable"}
                  {!isResuming &&
                    healthStatus === "unreachable" &&
                    "Agent is unreachable"}
                  {!isResuming && !healthStatus && "Checking agent status..."}
                </TooltipContent>
              </Tooltip>
            )}
            <Badge variant="secondary" className="text-xs">
              {workspace.type}
            </Badge>
            {workspace.packageManager &&
              workspace.packageManager !== "none" && (
                <Badge variant="outline" className="text-xs">
                  {workspace.packageManager}
                </Badge>
              )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-muted-foreground truncate font-mono text-xs">
          {workspace.path}
        </p>

        {workspace.linkedTaskMeta && (
          <a
            href={(workspace.linkedTaskMeta as LinkedTaskMeta).url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-muted-foreground hover:text-foreground group/task flex items-center gap-1.5 text-xs transition-colors"
          >
            <CheckSquare className="size-3 shrink-0 text-purple-500" />
            <span className="truncate group-hover/task:underline">
              {(workspace.linkedTaskMeta as LinkedTaskMeta).customId
                ? `${(workspace.linkedTaskMeta as LinkedTaskMeta).customId} · `
                : ""}
              {(workspace.linkedTaskMeta as LinkedTaskMeta).name}
            </span>
          </a>
        )}

        {gitStatus?.isRepo && (
          <div className="space-y-2">
            {/* Branch + tracking info */}
            <div className="flex items-center gap-2 text-xs">
              <div className="text-foreground flex items-center gap-1">
                <GitBranch className="size-3.5" />
                <span className="max-w-32 truncate font-medium">
                  {gitStatus.branch}
                </span>
              </div>
              {(gitStatus.ahead > 0 || gitStatus.behind > 0) && (
                <div className="text-muted-foreground flex items-center gap-1.5">
                  {gitStatus.ahead > 0 && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="flex items-center gap-0.5 text-green-500">
                          <ArrowUp className="size-3" />
                          {gitStatus.ahead}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        {gitStatus.ahead} commit{gitStatus.ahead > 1 ? "s" : ""}{" "}
                        ahead
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
                        {gitStatus.behind} commit
                        {gitStatus.behind > 1 ? "s" : ""} behind
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
                    {gitStatus.staged.length} staged,{" "}
                    {gitStatus.unstaged.length} modified,{" "}
                    {gitStatus.untracked.length} untracked
                  </TooltipContent>
                </Tooltip>
              )}
            </div>

            {/* Last commit */}
            {gitStatus.lastCommit && (
              <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
                <GitCommitHorizontal className="size-3 shrink-0" />
                <span className="flex-1 truncate">
                  {gitStatus.lastCommit.message}
                </span>
                <span className="flex shrink-0 items-center gap-0.5">
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
                      event.stopPropagation();
                      handleRunQuickCommand(cmd);
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
                event.stopPropagation();
                if (healthStatus === "suspended" && !isResuming) {
                  resume();
                }
                setActiveWorkspaceId(workspace.id);
              }}
              className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs"
            >
              <MessageSquare className="size-3" />
              Chat
            </Link>
            <Link
              href="/git"
              onClick={(event) => {
                event.stopPropagation();
                if (healthStatus === "suspended" && !isResuming) {
                  resume();
                }
                setActiveWorkspaceId(workspace.id);
              }}
              className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs"
            >
              <FolderOpen className="size-3" />
              Git
            </Link>
            <Link
              href={`/terminal?workspace=${workspace.id}`}
              onClick={(event) => {
                event.stopPropagation();
                if (healthStatus === "suspended" && !isResuming) {
                  resume();
                }
                setActiveWorkspaceId(workspace.id);
              }}
              className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs"
            >
              <TerminalSquare className="size-3" />
              Terminal
            </Link>
          </div>
          <div className="flex items-center gap-1">
            <QuickCommandsEditor workspace={workspace} />
            <WorkspaceTaskLinkMenu workspace={workspace} />
            {hasProvider ? (
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={(event) => event.stopPropagation()}
                    disabled={isDeleting}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  className="w-56 p-2"
                  align="end"
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className="space-y-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full justify-start text-xs"
                      onClick={() => onDelete(workspace.id)}
                      disabled={isDeleting}
                    >
                      Remove from list
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive w-full justify-start text-xs"
                      onClick={() => onDelete(workspace.id, true)}
                      disabled={isDeleting}
                    >
                      Remove &amp; destroy container
                    </Button>
                  </div>
                </PopoverContent>
              </Popover>
            ) : workspace.type === "worktree" ? (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={(event) => event.stopPropagation()}
                    disabled={isDeleting}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent
                  onClick={(event) => event.stopPropagation()}
                >
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete worktree</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will remove the worktree from disk. The branch itself
                      will not be deleted.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      onClick={() => onDelete(workspace.id)}
                    >
                      Delete worktree
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            ) : (
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={(event) => {
                  event.stopPropagation();
                  onDelete(workspace.id);
                }}
                disabled={isDeleting}
                className="text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="size-3.5" />
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function WorkspaceTaskLinkMenu({ workspace }: { workspace: Workspace }) {
  const queryClient = useQueryClient();
  const [isTaskPickerOpen, setIsTaskPickerOpen] = useState(false);

  const linkTaskMutation = useMutation({
    mutationFn: async (data: {
      linkedTaskId: string | null;
      linkedTaskMeta: LinkedTaskMeta | null;
    }) => {
      const response = await fetch(`/api/workspaces/${workspace.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to update linked task");
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      setIsTaskPickerOpen(false);
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const handleTaskSelect = useCallback(
    (task: ClickUpTask) => {
      const linkedTaskMeta: LinkedTaskMeta = {
        name: task.name,
        customId: task.custom_id,
        url: task.url,
        status: task.status.status,
        provider: "clickup",
      };

      linkTaskMutation.mutate({
        linkedTaskId: task.id,
        linkedTaskMeta,
      });
    },
    [linkTaskMutation],
  );

  const handleUnlink = useCallback(() => {
    linkTaskMutation.mutate({
      linkedTaskId: null,
      linkedTaskMeta: null,
    });
  }, [linkTaskMutation]);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground hover:text-foreground"
            onClick={(event) => event.stopPropagation()}
            disabled={linkTaskMutation.isPending}
          >
            <MoreHorizontal className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          onClick={(event) => event.stopPropagation()}
        >
          {workspace.linkedTaskId ? (
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault();
                handleUnlink();
              }}
              disabled={linkTaskMutation.isPending}
            >
              <Link2 className="mr-2 size-3.5" />
              Unlink Task
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault();
                setIsTaskPickerOpen(true);
              }}
            >
              <Link2 className="mr-2 size-3.5" />
              Link Task
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <TaskPicker
        open={isTaskPickerOpen}
        onOpenChange={setIsTaskPickerOpen}
        onSelectTask={handleTaskSelect}
        title="Link task"
        description={`Select a ClickUp task to link to ${workspace.name}`}
      />
    </>
  );
}

function WorkspaceColorPicker({ workspace }: { workspace: Workspace }) {
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);

  const updateMutation = useMutation({
    mutationFn: async (color: string | null) => {
      const res = await fetch(`/api/workspaces/${workspace.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ color }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to update color");
      }
      return res.json();
    },
    onSuccess: (_, color) => {
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      useWorkspaceStore.getState().updateWorkspace(workspace.id, { color });
      setIsOpen(false);
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "size-3 shrink-0 rounded-full border transition-colors hover:opacity-80",
            workspace.color
              ? "border-transparent"
              : "border-muted-foreground/30 bg-transparent",
          )}
          style={
            workspace.color ? { backgroundColor: workspace.color } : undefined
          }
          onClick={(e) => {
            e.stopPropagation();
          }}
        />
      </PopoverTrigger>
      <PopoverContent
        className="w-auto p-2"
        align="start"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-5 gap-1.5">
            {WORKSPACE_PRESET_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                className={cn(
                  "size-5 rounded-full border border-transparent transition-transform hover:scale-110",
                  workspace.color === color &&
                    "ring-primary ring-offset-background ring-2 ring-offset-1",
                )}
                style={{ backgroundColor: color }}
                onClick={() => updateMutation.mutate(color)}
                disabled={updateMutation.isPending}
              />
            ))}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground h-7 w-full justify-start text-xs"
            onClick={() => updateMutation.mutate(null)}
            disabled={updateMutation.isPending || !workspace.color}
          >
            <X className="mr-1.5 size-3" />
            Clear color
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function EditableWorkspaceName({ workspace }: { workspace: Workspace }) {
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(workspace.name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing]);

  const renameMutation = useMutation({
    mutationFn: async (newName: string) => {
      const res = await fetch(`/api/workspaces/${workspace.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to rename");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      toast.success("Workspace renamed");
    },
    onError: (err: Error) => {
      toast.error(err.message);
      setEditValue(workspace.name);
    },
  });

  const handleSave = useCallback(() => {
    const trimmed = editValue.trim();
    if (!trimmed || trimmed === workspace.name) {
      setEditValue(workspace.name);
      setIsEditing(false);
      return;
    }
    renameMutation.mutate(trimmed);
    setIsEditing(false);
  }, [editValue, workspace.name, renameMutation]);

  if (isEditing) {
    return (
      <Input
        ref={inputRef}
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onBlur={handleSave}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleSave();
          if (e.key === "Escape") {
            setEditValue(workspace.name);
            setIsEditing(false);
          }
        }}
        className="h-7 min-w-0 px-1 text-base font-semibold"
        onClick={(e) => e.stopPropagation()}
      />
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="group/name hover:text-primary flex min-w-0 items-center gap-1.5 transition-colors"
          onClick={(e) => {
            e.stopPropagation();
            setEditValue(workspace.name);
            setIsEditing(true);
          }}
        >
          <CardTitle className="min-w-0 truncate text-base">
            {workspace.name}
          </CardTitle>
          <Pencil className="size-3 shrink-0 opacity-0 transition-opacity group-hover/name:opacity-50" />
        </button>
      </TooltipTrigger>
      <TooltipContent>Click to rename</TooltipContent>
    </Tooltip>
  );
}

function QuickCommandsEditor({ workspace }: { workspace: Workspace }) {
  const queryClient = useQueryClient();
  const [commands, setCommands] = useState<QuickCommand[]>(
    workspace.quickCommands ?? [],
  );
  const [newLabel, setNewLabel] = useState("");
  const [newCommand, setNewCommand] = useState("");
  const [isOpen, setIsOpen] = useState(false);

  const saveMutation = useMutation({
    mutationFn: async (quickCommands: QuickCommand[]) => {
      const res = await fetch(`/api/workspaces/${workspace.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quickCommands }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to save");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      toast.success("Quick commands saved");
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  const handleAdd = () => {
    const label = newLabel.trim();
    const command = newCommand.trim();
    if (!label || !command) return;

    const updated = [...commands, { label, command }];
    setCommands(updated);
    setNewLabel("");
    setNewCommand("");
    saveMutation.mutate(updated);
  };

  const handleRemove = (index: number) => {
    const updated = commands.filter((_, i) => i !== index);
    setCommands(updated);
    saveMutation.mutate(updated);
  };

  return (
    <Popover
      open={isOpen}
      onOpenChange={(open) => {
        setIsOpen(open);
        if (open) setCommands(workspace.quickCommands ?? []);
      }}
    >
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
                <div
                  key={`${cmd.label}-${cmd.command}`}
                  className="flex items-center gap-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium">{cmd.label}</p>
                    <p className="text-muted-foreground truncate font-mono text-xs">
                      {cmd.command}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="text-muted-foreground hover:text-destructive shrink-0"
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
              className="h-7 font-mono text-xs"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAdd();
              }}
            />
            <Button
              size="sm"
              className="h-7 w-full text-xs"
              onClick={handleAdd}
              disabled={
                !newLabel.trim() || !newCommand.trim() || saveMutation.isPending
              }
            >
              <Plus className="mr-1 size-3" />
              Add Command
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function formatRelativeDate(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffMinutes < 1) return "just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 30) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}
