"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { GitFork, FolderGit2, Loader2, Plus, Link, X } from "lucide-react";
import { useCreateWorktree, useWorktreeSymlinks } from "@/hooks/use-git";
import { sanitizeBranchName } from "@/lib/utils";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { usePendingChatStore } from "@/stores/pending-chat-store";
import type { ClickUpTask, Workspace, LinkedTaskMeta } from "@/types";

const SYMLINK_SUGGESTIONS = [".npmrc", ".env", ".env.local", ".opencode/plans"];

interface TaskWorktreeDialogProps {
  task: ClickUpTask;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function formatPlanPrompt(task: ClickUpTask): string {
  const lines = [
    `Plan the implementation for this ClickUp task:`,
    ``,
    `**${task.name}**`,
  ];
  if (task.custom_id) lines.push(`Task ID: ${task.custom_id}`);
  lines.push(`Status: ${task.status.status}`);
  lines.push(`List: ${task.list.name}`);
  if (task.folder?.name) lines.push(`Folder: ${task.folder.name}`);
  if (task.priority) lines.push(`Priority: ${task.priority.priority}`);
  if (task.url) lines.push(`URL: ${task.url}`);
  lines.push(
    ``,
    `Please read the .opencode or .sisyphus directory for any existing plans or context, then create a plan for this task.`,
  );
  return lines.join("\n");
}

function slugify(text: string): string {
  return sanitizeBranchName(text).slice(0, 60);
}

export function TaskWorktreeDialog({
  task,
  open,
  onOpenChange,
}: TaskWorktreeDialogProps) {
  const router = useRouter();
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const addWorkspace = useWorkspaceStore((s) => s.addWorkspace);
  const setActiveWorkspaceId = useWorkspaceStore((s) => s.setActiveWorkspaceId);
  const setPendingChat = usePendingChatStore((s) => s.setPending);
  const repoWorkspaces = useMemo(
    () => workspaces.filter((w) => w.type === "repo"),
    [workspaces],
  );

  const defaultBranch = useMemo(() => slugify(task.name), [task.name]);

  const [selectedRepoId, setSelectedRepoId] = useState<string | null>(null);
  const [branchName, setBranchName] = useState(defaultBranch);
  const [customName, setCustomName] = useState("");
  const [startChat, setStartChat] = useState(true);
  const [additionalPrompt, setAdditionalPrompt] = useState("");
  const [symlinkPaths, setSymlinkPaths] = useState<string[]>([]);
  const [symlinkInput, setSymlinkInput] = useState("");

  const createWorktree = useCreateWorktree();
  const { data: savedSymlinks } = useWorktreeSymlinks(selectedRepoId);

  // Sync symlink paths from saved data (during render)
  const [prevSavedSymlinks, setPrevSavedSymlinks] = useState(savedSymlinks);
  if (
    prevSavedSymlinks !== savedSymlinks &&
    savedSymlinks &&
    savedSymlinks.length > 0
  ) {
    setPrevSavedSymlinks(savedSymlinks);
    setSymlinkPaths(savedSymlinks);
  }

  const selectedRepo = useMemo(
    () => repoWorkspaces.find((w) => w.id === selectedRepoId) ?? null,
    [repoWorkspaces, selectedRepoId],
  );

  const targetPath = useMemo(() => {
    if (!selectedRepo || !branchName) return "";
    return `${selectedRepo.path}-worktrees/${branchName}`;
  }, [selectedRepo, branchName]);

  const workspaceName = useMemo(() => {
    if (customName) return customName;
    if (!selectedRepo || !branchName) return "";
    const parentName =
      selectedRepo.path.split("/").filter(Boolean).pop() ?? selectedRepo.name;
    return `${parentName}/${branchName}`;
  }, [selectedRepo, branchName, customName]);

  function handleCreate() {
    if (!selectedRepo || !branchName) return;

    const taskMeta: LinkedTaskMeta = {
      name: task.name,
      customId: task.custom_id,
      url: task.url,
      status: task.status.status,
      provider: "clickup",
    };

    createWorktree.mutate(
      {
        parentWorkspaceId: selectedRepo.id,
        branch: sanitizeBranchName(branchName, "all"),
        newBranch: true,
        name: customName || undefined,
        symlinkPaths: symlinkPaths.length > 0 ? symlinkPaths : undefined,
        linkedTaskId: task.id,
        linkedTaskMeta: taskMeta,
      },
      {
        onSuccess: (data: { workspace: Workspace }) => {
          const newWorkspace = data.workspace;

          addWorkspace(newWorkspace);
          setActiveWorkspaceId(newWorkspace.id);

          if (startChat) {
            const planPrompt = formatPlanPrompt(task);
            const message = additionalPrompt.trim()
              ? `${planPrompt}\n\n---\n\nAdditional context:\n${additionalPrompt.trim()}`
              : planPrompt;

            setPendingChat({ workspaceId: newWorkspace.id, message });
            onOpenChange(false);
            resetState();
            router.push("/chat");
          } else {
            onOpenChange(false);
            resetState();
          }
        },
      },
    );
  }

  function resetState() {
    setSelectedRepoId(null);
    setBranchName(defaultBranch);
    setCustomName("");
    setStartChat(true);
    setAdditionalPrompt("");
    setSymlinkPaths([]);
    setSymlinkInput("");
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        onOpenChange(isOpen);
        if (!isOpen) resetState();
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
          <div className="bg-muted/30 rounded-md border px-3 py-2">
            <div className="truncate text-sm font-medium">{task.name}</div>
            <div className="mt-1 flex items-center gap-2">
              <Badge
                variant="secondary"
                className="px-1.5 py-0 text-xs"
                style={{ color: task.status.color }}
              >
                {task.status.status}
              </Badge>
              {task.custom_id && (
                <span className="text-muted-foreground font-mono text-xs">
                  {task.custom_id}
                </span>
              )}
              <span className="text-muted-foreground text-xs">
                {task.list.name}
              </span>
            </div>
          </div>

          {/* Repo selector */}
          <div className="space-y-2">
            <Label>Parent Repository</Label>
            {repoWorkspaces.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-4 text-center">
                <FolderGit2 className="text-muted-foreground h-8 w-8" />
                <p className="text-muted-foreground text-sm">
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
                      className={`hover:bg-accent flex w-full items-center gap-2.5 rounded-lg border p-2.5 text-left transition-colors ${
                        selectedRepoId === repo.id
                          ? "border-primary bg-accent"
                          : ""
                      }`}
                    >
                      <FolderGit2 className="h-4 w-4 shrink-0 text-orange-500" />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium">{repo.name}</div>
                        <div className="text-muted-foreground truncate font-mono text-xs">
                          {repo.path}
                        </div>
                      </div>
                      {repo.packageManager &&
                        repo.packageManager !== "none" && (
                          <Badge
                            variant="secondary"
                            className="shrink-0 text-xs"
                          >
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
              onChange={(e) =>
                setBranchName(sanitizeBranchName(e.target.value))
              }
              onBlur={() => setBranchName((v) => sanitizeBranchName(v, "all"))}
              placeholder={defaultBranch}
              className="font-mono text-sm"
            />
          </div>

          {/* Custom display name */}
          <div className="space-y-2">
            <Label
              htmlFor="task-custom-name"
              className="text-muted-foreground text-xs"
            >
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

          {/* Symlink configuration */}
          <div className="space-y-2">
            <Label className="flex items-center gap-1.5 text-sm">
              <Link className="h-3.5 w-3.5" />
              Symlink files
            </Label>
            <p className="text-muted-foreground text-xs">
              Symlink gitignored files from the parent repo into the new
              worktree.
            </p>
            {symlinkPaths.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {symlinkPaths.map((p) => (
                  <Badge
                    key={p}
                    variant="secondary"
                    className="gap-1 font-mono text-xs"
                  >
                    {p}
                    <button
                      type="button"
                      onClick={() =>
                        setSymlinkPaths(symlinkPaths.filter((s) => s !== p))
                      }
                      className="hover:text-destructive ml-0.5"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <Input
                value={symlinkInput}
                onChange={(e) => setSymlinkInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    const trimmed = symlinkInput.trim();
                    if (trimmed && !symlinkPaths.includes(trimmed)) {
                      setSymlinkPaths([...symlinkPaths, trimmed]);
                      setSymlinkInput("");
                    }
                  }
                }}
                placeholder=".env, .npmrc, etc."
                className="font-mono text-xs"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={
                  !symlinkInput.trim() ||
                  symlinkPaths.includes(symlinkInput.trim())
                }
                onClick={() => {
                  const trimmed = symlinkInput.trim();
                  if (trimmed && !symlinkPaths.includes(trimmed)) {
                    setSymlinkPaths([...symlinkPaths, trimmed]);
                    setSymlinkInput("");
                  }
                }}
              >
                Add
              </Button>
            </div>
            <div className="flex flex-wrap gap-1">
              {SYMLINK_SUGGESTIONS.filter((s) => !symlinkPaths.includes(s)).map(
                (s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSymlinkPaths([...symlinkPaths, s])}
                    className="text-muted-foreground hover:bg-accent hover:text-foreground rounded-md border px-2 py-0.5 font-mono text-xs transition-colors"
                  >
                    + {s}
                  </button>
                ),
              )}
            </div>
          </div>

          {/* Preview */}
          {selectedRepo && branchName && (
            <div className="bg-muted/30 space-y-1.5 rounded-md border px-3 py-2">
              <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
                <GitFork className="h-3 w-3" />
                <span>Will create:</span>
              </div>
              <div className="font-mono text-xs break-all">{targetPath}</div>
              <div className="text-muted-foreground text-xs">
                as{" "}
                <span className="text-foreground font-medium">
                  {workspaceName}
                </span>
              </div>
            </div>
          )}

          {/* Start chat toggle */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label
                htmlFor="start-chat-toggle"
                className="cursor-pointer text-sm"
              >
                Start chat with plan prompt
              </Label>
              <Switch
                id="start-chat-toggle"
                checked={startChat}
                onCheckedChange={setStartChat}
              />
            </div>
            {startChat && (
              <textarea
                value={additionalPrompt}
                onChange={(e) => setAdditionalPrompt(e.target.value)}
                placeholder="Additional context (optional)"
                rows={3}
                className="bg-background placeholder:text-muted-foreground focus-visible:ring-ring w-full resize-none rounded-md border px-3 py-2 text-sm focus-visible:ring-1 focus-visible:outline-none"
              />
            )}
          </div>

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
  );
}
