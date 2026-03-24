"use client";

import { Fragment, useState, useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import Link from "next/link";
import {
  X,
  ExternalLink,
  GitFork,
  Loader2,
  AlertTriangle,
  Clock,
  User,
  MoreHorizontal,
  FolderOpen,
  Cloud,
  MessageSquare,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TaskWorktreeDialog } from "@/components/dashboard/task-worktree-dialog";
import { CreateProviderWorkspaceDialog } from "@/components/workspace/create-provider-workspace-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useClickUpTaskDetail,
  useClickUpTaskComments,
} from "@/hooks/use-clickup";
import { useWorkspaceProviders } from "@/hooks/use-settings";
import { cn } from "@/lib/utils";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { toast } from "sonner";
import type {
  ClickUpTask,
  ClickUpCustomField,
  LinkedTaskMeta,
  Workspace,
} from "@/types";

const PRIORITY_LABELS: Record<string, string> = {
  urgent: "Urgent",
  high: "High",
  normal: "Normal",
  low: "Low",
};

const PRIORITY_COLORS: Record<string, string> = {
  urgent: "bg-red-500",
  high: "bg-orange-500",
  normal: "bg-blue-500",
  low: "bg-gray-400",
};

function formatRelativeTime(unixMs: string): string {
  const diffMs = Date.now() - Number(unixMs);
  const diffMinutes = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffMinutes < 1) return "just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 30) return `${diffDays}d ago`;
  return new Date(Number(unixMs)).toLocaleDateString();
}

function formatDuration(ms: number): string {
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function CustomFieldValue({ field }: { field: ClickUpCustomField }) {
  if (field.value == null || field.value === "")
    return <span className="text-muted-foreground">—</span>;

  if (
    typeof field.value === "object" &&
    field.value !== null &&
    "percent_completed" in field.value
  ) {
    const v = field.value as { percent_completed?: number; current?: string };
    const pct = v.percent_completed ?? Number(v.current) / 100;
    return <span>{isNaN(pct) ? "—" : `${Math.round(pct * 100)}%`}</span>;
  }

  switch (field.type) {
    case "number":
      return <span>{String(field.value)}</span>;
    case "text":
    case "email":
    case "url":
    case "phone":
      return <span className="break-all">{String(field.value)}</span>;
    case "date": {
      const ts = Number(field.value);
      return (
        <span>
          {isNaN(ts) ? String(field.value) : new Date(ts).toLocaleDateString()}
        </span>
      );
    }
    case "checkbox":
      return <span>{field.value ? "Yes" : "No"}</span>;
    case "dropdown": {
      const config = field.type_config as
        | {
            options?: Array<{
              orderindex: number;
              name: string;
              color: string;
            }>;
          }
        | undefined;
      const options = config?.options ?? [];
      const selected = options.find((o) => o.orderindex === field.value);
      return selected ? (
        <Badge
          variant="secondary"
          className="text-xs"
          style={{ color: selected.color }}
        >
          {selected.name}
        </Badge>
      ) : (
        <span>{String(field.value)}</span>
      );
    }
    case "labels": {
      const labels = Array.isArray(field.value) ? field.value : [];
      const config = field.type_config as
        | { options?: Array<{ id: string; label: string; color: string }> }
        | undefined;
      const options = config?.options ?? [];
      return (
        <div className="flex flex-wrap gap-1">
          {(labels as string[]).map((labelId) => {
            const opt = options.find((o) => o.id === labelId);
            return (
              <Badge
                key={labelId}
                variant="secondary"
                className="text-xs"
                style={
                  opt
                    ? { backgroundColor: opt.color + "33", color: opt.color }
                    : undefined
                }
              >
                {opt?.label ?? labelId}
              </Badge>
            );
          })}
        </div>
      );
    }
    default:
      return (
        <span className="text-muted-foreground text-xs break-all">
          {typeof field.value === "string"
            ? field.value
            : JSON.stringify(field.value)}
        </span>
      );
  }
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

function LinkedWorkspaceRow({
  workspace,
  onUnlink,
  isPending,
}: {
  workspace: Workspace;
  onUnlink: (workspaceId: string) => void;
  isPending: boolean;
}) {
  const setActiveWorkspaceId = useWorkspaceStore((s) => s.setActiveWorkspaceId);
  const isRemote = workspace.backend === "remote";

  return (
    <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
      <button
        type="button"
        onClick={() => setActiveWorkspaceId(workspace.id)}
        className="hover:text-foreground flex min-w-0 flex-1 items-center gap-2 text-left transition-colors"
      >
        {isRemote ? (
          <Cloud className="text-muted-foreground size-3.5 shrink-0" />
        ) : (
          <FolderOpen className="text-muted-foreground size-3.5 shrink-0" />
        )}
        <span className="truncate font-medium">{workspace.name}</span>
        <Badge variant="secondary" className="ml-auto shrink-0 text-xs">
          {workspace.type}
        </Badge>
      </button>
      <Link
        href="/chat"
        onClick={() => setActiveWorkspaceId(workspace.id)}
        className="text-muted-foreground hover:text-foreground hover:bg-muted shrink-0 rounded p-1 transition-colors"
        title="Open chat"
      >
        <MessageSquare className="size-3.5" />
      </Link>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="text-muted-foreground hover:text-destructive size-7 shrink-0"
        onClick={() => onUnlink(workspace.id)}
        disabled={isPending}
      >
        <X className="size-3.5" />
      </Button>
    </div>
  );
}

interface TaskDetailPanelProps {
  task: ClickUpTask;
  onClose: () => void;
  style?: React.CSSProperties;
  className?: string;
}

export function TaskDetailPanel({
  task,
  onClose,
  style,
  className,
}: TaskDetailPanelProps) {
  const queryClient = useQueryClient();
  const [worktreeOpen, setWorktreeOpen] = useState(false);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState("");

  const {
    data: detail,
    isLoading: isLoadingDetail,
    error: detailError,
  } = useClickUpTaskDetail(task.id);
  const { data: comments, isLoading: isLoadingComments } =
    useClickUpTaskComments(task.id);
  const { providers } = useWorkspaceProviders();
  const workspaces = useWorkspaceStore((s) => s.workspaces);

  const firstLinkedRepo = useMemo(() => {
    for (const ws of workspaces) {
      if (ws.backend === "remote" && ws.providerMeta) {
        const meta = ws.providerMeta as Record<string, unknown>;
        if (typeof meta.repo === "string" && meta.repo.trim()) {
          return meta.repo;
        }
      }
    }
    return undefined;
  }, [workspaces]);

  const suggestedBranch = useMemo(() => {
    const prefix = task.custom_id ? `${task.custom_id.toLowerCase()}/` : "";
    return prefix + slugify(task.name);
  }, [task.custom_id, task.name]);

  const priorityColor = task.priority
    ? (PRIORITY_COLORS[task.priority.priority] ?? "bg-gray-400")
    : null;

  const linkedWorkspaces = useMemo(
    () => workspaces.filter((ws) => ws.linkedTaskId === task.id),
    [workspaces, task.id],
  );

  const linkableWorkspaces = useMemo(
    () =>
      workspaces.filter(
        (ws) => !ws.linkedTaskId || ws.linkedTaskId === task.id,
      ),
    [workspaces, task.id],
  );

  const hasLinkedWorkspaces = linkedWorkspaces.length > 0;

  const workspaceLinkMutation = useMutation({
    mutationFn: async ({
      workspaceId,
      linkedTaskId,
      linkedTaskMeta,
    }: {
      workspaceId: string;
      linkedTaskId: string | null;
      linkedTaskMeta: LinkedTaskMeta | null;
    }) => {
      const response = await fetch(`/api/workspaces/${workspaceId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ linkedTaskId, linkedTaskMeta }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to update workspace link");
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      setSelectedWorkspaceId("");
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const handleLinkWorkspace = (workspaceId: string) => {
    const linkedTaskMeta: LinkedTaskMeta = {
      name: task.name,
      customId: task.custom_id,
      url: task.url,
      status: task.status.status,
      provider: "clickup",
    };

    workspaceLinkMutation.mutate({
      workspaceId,
      linkedTaskId: task.id,
      linkedTaskMeta,
    });
  };

  const handleUnlinkWorkspace = (workspaceId: string) => {
    workspaceLinkMutation.mutate({
      workspaceId,
      linkedTaskId: null,
      linkedTaskMeta: null,
    });
  };

  const nonEmptyCustomFields = (detail?.custom_fields ?? []).filter(
    (f) =>
      f.value != null &&
      f.value !== "" &&
      !(Array.isArray(f.value) && f.value.length === 0),
  );

  return (
    <>
      <div
        className={cn(
          "bg-background flex h-full min-w-0 shrink-0 flex-col overflow-hidden border-l",
          className,
        )}
        style={style}
      >
        {/* Header */}
        <div className="flex items-start gap-2 border-b p-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              {priorityColor && (
                <span
                  className={`size-2 shrink-0 rounded-full ${priorityColor}`}
                />
              )}
              <Badge
                variant="secondary"
                className="px-1.5 py-0 text-xs font-normal"
                style={{ color: task.status.color }}
              >
                {task.status.status}
              </Badge>
              {task.priority && (
                <span className="text-muted-foreground text-xs">
                  {PRIORITY_LABELS[task.priority.priority]}
                </span>
              )}
              {task.custom_id && (
                <span className="text-muted-foreground font-mono text-xs">
                  {task.custom_id}
                </span>
              )}
              <span className="text-muted-foreground font-mono text-xs">
                {task.id}
              </span>
            </div>
            <h2 className="mt-1 text-sm leading-snug font-semibold">
              {task.name}
            </h2>
            <p className="text-muted-foreground mt-0.5 text-xs">
              {task.list.name}
              {task.folder?.name &&
                task.folder.name !== "hidden" &&
                ` · ${task.folder.name}`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground hover:bg-muted shrink-0 rounded p-1 transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>

        <ScrollArea className="min-w-0 flex-1 [&_[data-slot=scroll-area-viewport]>div]:!block">
          <div className="space-y-5 overflow-hidden p-3">
            {/* Linked workspaces */}
            {hasLinkedWorkspaces && (
              <div className="space-y-1.5">
                {linkedWorkspaces.map((ws) => (
                  <LinkedWorkspaceRow
                    key={ws.id}
                    workspace={ws}
                    onUnlink={handleUnlinkWorkspace}
                    isPending={workspaceLinkMutation.isPending}
                  />
                ))}
              </div>
            )}

            {/* Actions */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-2">
                <Select
                  value={selectedWorkspaceId}
                  onValueChange={(workspaceId) => {
                    setSelectedWorkspaceId(workspaceId);
                    handleLinkWorkspace(workspaceId);
                  }}
                >
                  <SelectTrigger size="sm" className="h-8 w-[220px]">
                    <SelectValue placeholder="Link Workspace" />
                  </SelectTrigger>
                  <SelectContent align="start">
                    {linkableWorkspaces.length > 0 ? (
                      linkableWorkspaces.map((workspace) => (
                        <SelectItem key={workspace.id} value={workspace.id}>
                          {workspace.name}
                        </SelectItem>
                      ))
                    ) : (
                      <SelectItem value="none" disabled>
                        No workspaces available
                      </SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>

              {hasLinkedWorkspaces ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" variant="outline">
                      <MoreHorizontal className="mr-2 size-3.5" />
                      New Workspace
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem onClick={() => setWorktreeOpen(true)}>
                      <GitFork className="mr-2 size-3.5" />
                      Create Worktree
                    </DropdownMenuItem>
                    {providers.length > 0 && (
                      <CreateProviderWorkspaceDialog
                        workspaces={workspaces}
                        initialRepo={firstLinkedRepo}
                        initialBranch={suggestedBranch}
                        triggerSize="sm"
                        task={task}
                        dropdownItem
                      />
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setWorktreeOpen(true)}
                  >
                    <GitFork className="mr-2 size-3.5" />
                    Create Worktree
                  </Button>
                  {providers.length > 0 && (
                    <CreateProviderWorkspaceDialog
                      workspaces={workspaces}
                      initialRepo={firstLinkedRepo}
                      initialBranch={suggestedBranch}
                      triggerSize="sm"
                      task={task}
                    />
                  )}
                </>
              )}
              <a href={task.url} target="_blank" rel="noopener noreferrer">
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-muted-foreground"
                >
                  <ExternalLink className="mr-2 size-3.5" />
                  Open in ClickUp
                </Button>
              </a>
            </div>

            {/* Metadata */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              {task.assignees.length > 0 && (
                <>
                  <span className="text-muted-foreground flex items-center gap-1">
                    <User className="size-3" /> Assignees
                  </span>
                  <span>
                    {task.assignees.map((a) => a.username).join(", ")}
                  </span>
                </>
              )}
              {task.due_date && (
                <>
                  <span className="text-muted-foreground">Due</span>
                  <span>
                    {new Date(Number(task.due_date)).toLocaleDateString()}
                  </span>
                </>
              )}
              {detail?.time_estimate != null && detail.time_estimate > 0 && (
                <>
                  <span className="text-muted-foreground flex items-center gap-1">
                    <Clock className="size-3" /> Estimate
                  </span>
                  <span>{formatDuration(detail.time_estimate)}</span>
                </>
              )}
              {detail?.time_spent != null && detail.time_spent > 0 && (
                <>
                  <span className="text-muted-foreground">Time spent</span>
                  <span>{formatDuration(detail.time_spent)}</span>
                </>
              )}
              <span className="text-muted-foreground">Updated</span>
              <span>{formatRelativeTime(task.date_updated)}</span>
            </div>

            {/* Custom fields */}
            {isLoadingDetail ? (
              <div className="space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            ) : detailError ? (
              <div className="text-destructive flex items-center gap-2 text-xs">
                <AlertTriangle className="size-3.5" />
                Failed to load task details
              </div>
            ) : nonEmptyCustomFields.length > 0 ? (
              <div>
                <div className="text-muted-foreground mb-2 text-xs font-semibold tracking-wide uppercase">
                  Custom Fields
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                  {nonEmptyCustomFields.map((field) => (
                    <Fragment key={field.id}>
                      <span
                        className="text-muted-foreground truncate"
                        title={field.name}
                      >
                        {field.name}
                      </span>
                      <div>
                        <CustomFieldValue field={field} />
                      </div>
                    </Fragment>
                  ))}
                </div>
              </div>
            ) : null}

            {/* Description */}
            {isLoadingDetail ? (
              <div className="space-y-1.5">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
                <Skeleton className="h-4 w-4/6" />
              </div>
            ) : detail?.markdown_description ? (
              <div>
                <div className="text-muted-foreground mb-2 text-xs font-semibold tracking-wide uppercase">
                  Description
                </div>
                <div className="prose prose-sm dark:prose-invert max-w-none text-sm break-words">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {detail.markdown_description}
                  </ReactMarkdown>
                </div>
              </div>
            ) : null}

            {/* Comments */}
            <div>
              <div className="text-muted-foreground mb-2 text-xs font-semibold tracking-wide uppercase">
                Comments
              </div>
              {isLoadingComments ? (
                <div className="text-muted-foreground flex items-center gap-2 text-xs">
                  <Loader2 className="size-3 animate-spin" />
                  Loading comments...
                </div>
              ) : !comments || comments.length === 0 ? (
                <p className="text-muted-foreground text-xs">
                  No comments yet.
                </p>
              ) : (
                <div className="space-y-3">
                  {comments.map((comment) => (
                    <div key={comment.id} className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium">
                          {comment.user.username}
                        </span>
                        <span className="text-muted-foreground text-xs">
                          {formatRelativeTime(comment.date)}
                        </span>
                        {comment.resolved && (
                          <Badge
                            variant="secondary"
                            className="px-1 py-0 text-xs"
                          >
                            resolved
                          </Badge>
                        )}
                      </div>
                      <p className="text-muted-foreground text-xs leading-relaxed whitespace-pre-wrap">
                        {comment.comment_text}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </ScrollArea>
      </div>

      <TaskWorktreeDialog
        task={task}
        open={worktreeOpen}
        onOpenChange={setWorktreeOpen}
      />
    </>
  );
}
