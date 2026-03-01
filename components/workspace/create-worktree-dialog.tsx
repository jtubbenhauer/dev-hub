"use client"

import { useState, useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  GitBranch,
  GitFork,
  Plus,
  Loader2,
  FolderGit2,
  Search,
  Check,
} from "lucide-react"
import { useCreateWorktree, useGitBranches } from "@/hooks/use-git"
import type { Workspace, GitBranch as GitBranchType } from "@/types"

interface CreateWorktreeDialogProps {
  workspaces: Workspace[]
}

export function CreateWorktreeDialog({ workspaces }: CreateWorktreeDialogProps) {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<"select-repo" | "configure">("select-repo")
  const [selectedRepo, setSelectedRepo] = useState<Workspace | null>(null)
  const [branchName, setBranchName] = useState("")
  const [isNewBranch, setIsNewBranch] = useState(true)
  const [startPoint, setStartPoint] = useState("")
  const [customName, setCustomName] = useState("")
  const [branchFilter, setBranchFilter] = useState("")

  const createWorktree = useCreateWorktree()

  // Filter to only repo-type workspaces (not worktrees)
  const repoWorkspaces = useMemo(
    () => workspaces.filter((w) => w.type === "repo"),
    [workspaces]
  )

  // Fetch branches for the selected repo
  const { data: branches = [], isLoading: branchesLoading } = useGitBranches(
    selectedRepo?.id ?? null
  )

  // Filter branches based on search
  const filteredBranches = useMemo(() => {
    if (!branchFilter) return branches
    const lower = branchFilter.toLowerCase()
    return branches.filter((b) => b.name.toLowerCase().includes(lower))
  }, [branches, branchFilter])

  // Compute the target path preview
  const targetPath = useMemo(() => {
    if (!selectedRepo || !branchName) return ""
    return `${selectedRepo.path}-worktrees/${branchName}`
  }, [selectedRepo, branchName])

  // Auto-generated workspace name preview
  const workspaceName = useMemo(() => {
    if (customName) return customName
    if (!selectedRepo || !branchName) return ""
    const parentName =
      selectedRepo.path.split("/").filter(Boolean).pop() ?? selectedRepo.name
    return `${parentName}/${branchName}`
  }, [selectedRepo, branchName, customName])

  function handleSelectRepo(workspace: Workspace) {
    setSelectedRepo(workspace)
    setBranchName("")
    setStartPoint("")
    setBranchFilter("")
    setStep("configure")
  }

  function handleSelectExistingBranch(branch: GitBranchType) {
    setBranchName(branch.name)
    setIsNewBranch(false)
  }

  function handleCreate() {
    if (!selectedRepo || !branchName) return

    createWorktree.mutate(
      {
        parentRepoPath: selectedRepo.path,
        branch: branchName,
        newBranch: isNewBranch,
        startPoint: startPoint || undefined,
        name: customName || undefined,
      },
      {
        onSuccess: () => {
          setOpen(false)
          resetState()
        },
      }
    )
  }

  function resetState() {
    setStep("select-repo")
    setSelectedRepo(null)
    setBranchName("")
    setIsNewBranch(true)
    setStartPoint("")
    setCustomName("")
    setBranchFilter("")
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        setOpen(isOpen)
        if (!isOpen) resetState()
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="icon" className="sm:size-auto sm:px-3 sm:py-2">
          <GitFork className="h-4 w-4 sm:mr-2" />
          <span className="hidden sm:inline">Create Worktree</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[550px]">
        <DialogHeader>
          <DialogTitle>
            {step === "select-repo" ? "Select Parent Repository" : "Create Worktree"}
          </DialogTitle>
        </DialogHeader>

        {step === "select-repo" ? (
          <RepoSelector
            repos={repoWorkspaces}
            onSelect={handleSelectRepo}
          />
        ) : (
          <WorktreeConfigForm
            selectedRepo={selectedRepo!}
            branches={filteredBranches}
            branchesLoading={branchesLoading}
            branchName={branchName}
            setBranchName={setBranchName}
            isNewBranch={isNewBranch}
            setIsNewBranch={setIsNewBranch}
            startPoint={startPoint}
            setStartPoint={setStartPoint}
            customName={customName}
            setCustomName={setCustomName}
            branchFilter={branchFilter}
            setBranchFilter={setBranchFilter}
            targetPath={targetPath}
            workspaceName={workspaceName}
            onBack={() => setStep("select-repo")}
            onSelectBranch={handleSelectExistingBranch}
            onCreate={handleCreate}
            isCreating={createWorktree.isPending}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

// --- Sub-components ---

function RepoSelector({
  repos,
  onSelect,
}: {
  repos: Workspace[]
  onSelect: (w: Workspace) => void
}) {
  if (repos.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <FolderGit2 className="h-12 w-12 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          No repositories registered. Add a repo workspace first.
        </p>
      </div>
    )
  }

  return (
    <ScrollArea className="max-h-[400px]">
      <div className="space-y-2 pr-4">
        {repos.map((repo) => (
          <button
            key={repo.id}
            onClick={() => onSelect(repo)}
            className="flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-accent"
          >
            <FolderGit2 className="h-5 w-5 shrink-0 text-orange-500" />
            <div className="min-w-0 flex-1">
              <div className="font-medium">{repo.name}</div>
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
  )
}

function WorktreeConfigForm({
  selectedRepo,
  branches,
  branchesLoading,
  branchName,
  setBranchName,
  isNewBranch,
  setIsNewBranch,
  startPoint,
  setStartPoint,
  customName,
  setCustomName,
  branchFilter,
  setBranchFilter,
  targetPath,
  workspaceName,
  onBack,
  onSelectBranch,
  onCreate,
  isCreating,
}: {
  selectedRepo: Workspace
  branches: GitBranchType[]
  branchesLoading: boolean
  branchName: string
  setBranchName: (v: string) => void
  isNewBranch: boolean
  setIsNewBranch: (v: boolean) => void
  startPoint: string
  setStartPoint: (v: string) => void
  customName: string
  setCustomName: (v: string) => void
  branchFilter: string
  setBranchFilter: (v: string) => void
  targetPath: string
  workspaceName: string
  onBack: () => void
  onSelectBranch: (b: GitBranchType) => void
  onCreate: () => void
  isCreating: boolean
}) {
  // Branches that aren't already checked out in a worktree
  const availableBranches = branches.filter((b) => !b.linkedWorkTree && !b.current)

  return (
    <div className="space-y-4">
      {/* Parent repo indicator */}
      <div className="flex items-center gap-2 rounded-md bg-muted/50 px-3 py-2">
        <FolderGit2 className="h-4 w-4 text-orange-500" />
        <span className="text-sm font-medium">{selectedRepo.name}</span>
        <button
          onClick={onBack}
          className="ml-auto text-xs text-muted-foreground hover:text-foreground"
        >
          Change
        </button>
      </div>

      {/* New branch toggle */}
      <div className="flex items-center justify-between">
        <Label htmlFor="new-branch" className="text-sm">
          Create new branch
        </Label>
        <Switch
          id="new-branch"
          checked={isNewBranch}
          onCheckedChange={(checked) => {
            setIsNewBranch(checked)
            if (checked) setBranchName("")
          }}
        />
      </div>

      {isNewBranch ? (
        /* New branch name input */
        <div className="space-y-2">
          <Label htmlFor="branch-name">Branch name</Label>
          <Input
            id="branch-name"
            value={branchName}
            onChange={(e) => setBranchName(e.target.value)}
            placeholder="feature/my-feature"
            className="font-mono text-sm"
          />
          <div className="space-y-2">
            <Label htmlFor="start-point" className="text-xs text-muted-foreground">
              Start from (optional, defaults to HEAD)
            </Label>
            <Input
              id="start-point"
              value={startPoint}
              onChange={(e) => setStartPoint(e.target.value)}
              placeholder="main, origin/main, or a commit SHA"
              className="font-mono text-xs"
            />
          </div>
        </div>
      ) : (
        /* Existing branch picker */
        <div className="space-y-2">
          <Label>Select existing branch</Label>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={branchFilter}
              onChange={(e) => setBranchFilter(e.target.value)}
              placeholder="Filter branches..."
              className="pl-8 font-mono text-sm"
            />
          </div>
          <ScrollArea className="max-h-[200px]">
            <div className="space-y-1 pr-4">
              {branchesLoading ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              ) : availableBranches.length === 0 ? (
                <p className="py-4 text-center text-xs text-muted-foreground">
                  {branches.length === 0
                    ? "No branches found"
                    : "All branches are already checked out"}
                </p>
              ) : (
                availableBranches.map((branch) => (
                  <button
                    key={branch.name}
                    onClick={() => onSelectBranch(branch)}
                    className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent ${
                      branchName === branch.name ? "bg-accent" : ""
                    }`}
                  >
                    <GitBranch className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate font-mono text-xs">{branch.name}</span>
                    {branchName === branch.name && (
                      <Check className="ml-auto h-3.5 w-3.5 text-primary" />
                    )}
                  </button>
                ))
              )}
            </div>
          </ScrollArea>
        </div>
      )}

      {/* Custom display name */}
      <div className="space-y-2">
        <Label htmlFor="custom-name" className="text-xs text-muted-foreground">
          Display name (optional)
        </Label>
        <Input
          id="custom-name"
          value={customName}
          onChange={(e) => setCustomName(e.target.value)}
          placeholder={workspaceName || "auto-generated"}
          className="text-sm"
        />
      </div>

      {/* Preview */}
      {branchName && (
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
        onClick={onCreate}
        disabled={isCreating || !branchName}
        className="w-full"
      >
        {isCreating ? (
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
  )
}
