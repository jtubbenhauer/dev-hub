"use client"

import { useState, useCallback, useMemo, useRef, useEffect } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Terminal, Loader2, ChevronsUpDown, Check, Plus, GitBranch, Minus } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { useWorkspaceProviders } from "@/hooks/use-settings"
import { useProviderCreationStore } from "@/stores/provider-creation-store"
import type { Workspace } from "@/types"

interface CreateProviderWorkspaceDialogProps {
  workspaces: Workspace[]
}

export function CreateProviderWorkspaceDialog({ workspaces }: CreateProviderWorkspaceDialogProps) {
  const queryClient = useQueryClient()
  const { providers } = useWorkspaceProviders()

  const [formOpen, setFormOpen] = useState(false)
  const [providerId, setProviderId] = useState(() =>
    providers.length === 1 ? providers[0].id : ""
  )
  const [repo, setRepo] = useState("")
  const [branch, setBranch] = useState("")
  const [name, setName] = useState("")
  const [context, setContext] = useState("")
  const [repoPopoverOpen, setRepoPopoverOpen] = useState(false)
  const [repoSearch, setRepoSearch] = useState("")
  const [branchPopoverOpen, setBranchPopoverOpen] = useState(false)
  const [branchSearch, setBranchSearch] = useState("")

  const creationStore = useProviderCreationStore()
  const phase = creationStore.phase
  const storeDialogOpen = creationStore.dialogOpen

  // Dialog is open when: showing form OR store says dialog should be open (running/done/error)
  const isDialogOpen = phase === "idle" ? formOpen : storeDialogOpen

  const outputEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (creationStore.outputLines.length > 0 || creationStore.statusMessage) {
      outputEndRef.current?.scrollIntoView({ behavior: "smooth" })
    }
  }, [creationStore.outputLines.length, creationStore.statusMessage])

  const selectedProvider = useMemo(
    () => providers.find((p) => p.id === providerId),
    [providers, providerId]
  )

  const linkedRepos = useMemo(() => {
    const repos = new Map<string, string>()
    for (const ws of workspaces) {
      if (ws.backend === "remote" && ws.providerMeta) {
        const meta = ws.providerMeta as Record<string, unknown>
        if (typeof meta.repo === "string" && meta.repo.trim()) {
          if (!repos.has(meta.repo)) {
            repos.set(meta.repo, ws.name)
          }
        }
      }
    }
    return Array.from(repos.entries()).map(([url, wsName]) => ({
      url,
      label: wsName,
    }))
  }, [workspaces])

  const trimmedRepo = repo.trim()

  const { data: remoteBranches = [], isFetching: isFetchingBranches } = useQuery<string[]>({
    queryKey: ["remote-branches", trimmedRepo],
    queryFn: async () => {
      const res = await fetch(`/api/providers/remote-branches?repo=${encodeURIComponent(trimmedRepo)}`)
      if (!res.ok) return []
      const data = await res.json() as { branches: string[] }
      return data.branches
    },
    enabled: !!trimmedRepo,
    staleTime: 5 * 60 * 1000,
    retry: false,
  })

  const filteredBranches = useMemo(() => {
    if (!branchSearch) return remoteBranches
    const lower = branchSearch.toLowerCase()
    return remoteBranches.filter((b) => b.toLowerCase().includes(lower))
  }, [remoteBranches, branchSearch])

  const canSubmit = !!providerId && !!repo.trim()

  const handleCreate = useCallback(() => {
    if (!canSubmit || !selectedProvider) return

    setFormOpen(false)

    creationStore.startCreation({
      providerId,
      providerName: selectedProvider.name,
      repo: repo.trim(),
      branch: branch.trim() || undefined,
      name: name.trim() || undefined,
      context: context.trim() || undefined,
      onSuccess: (workspaceName) => {
        queryClient.invalidateQueries({ queryKey: ["workspaces"] })
        toast.success(`Created workspace "${workspaceName}" via ${selectedProvider.name}`)
      },
    })
  }, [canSubmit, selectedProvider, providerId, repo, branch, name, context, queryClient, creationStore])

  function resetFormState() {
    setProviderId(providers.length === 1 ? providers[0].id : "")
    setRepo("")
    setBranch("")
    setName("")
    setContext("")
    setRepoSearch("")
    setBranchSearch("")
  }

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && canSubmit && phase === "idle") handleCreate()
    },
    [canSubmit, phase, handleCreate]
  )

  function handleDialogChange(isOpen: boolean) {
    if (!isOpen) {
      if (phase === "running") {
        // Minimize instead of closing when running
        creationStore.minimize()
        return
      }
      if (phase === "done" || phase === "error") {
        creationStore.dismiss()
      }
      resetFormState()
    }
    setFormOpen(isOpen)
  }

  if (providers.length === 0) return null

  const isRunning = phase === "running"

  return (
    <Dialog open={isDialogOpen} onOpenChange={handleDialogChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="icon" className="sm:size-auto sm:px-3 sm:py-2">
          <Terminal className="h-4 w-4 sm:mr-2" />
          <span className="hidden sm:inline">Create via Provider</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[600px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Workspace via Provider</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {phase === "idle" && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="provider-select">Provider</Label>
                <Select value={providerId} onValueChange={setProviderId}>
                  <SelectTrigger id="provider-select">
                    <SelectValue placeholder="Select a provider" />
                  </SelectTrigger>
                  <SelectContent>
                    {providers.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Repository</Label>
                <Popover open={repoPopoverOpen} onOpenChange={setRepoPopoverOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      aria-expanded={repoPopoverOpen}
                      className="w-full justify-between font-mono text-sm h-9"
                    >
                      <span className={cn("truncate", !repo && "text-muted-foreground")}>
                        {repo || "Select or enter a repository URL"}
                      </span>
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="!w-[--radix-popover-trigger-width] p-0" align="start">
                    <Command shouldFilter={false}>
                      <CommandInput
                        placeholder="Search or paste a repo URL..."
                        value={repoSearch}
                        onValueChange={setRepoSearch}
                      />
                      <CommandList>
                        {linkedRepos.length > 0 && (
                          <CommandGroup heading="Linked repositories">
                            {linkedRepos
                              .filter((r) =>
                                !repoSearch ||
                                r.url.toLowerCase().includes(repoSearch.toLowerCase()) ||
                                r.label.toLowerCase().includes(repoSearch.toLowerCase())
                              )
                              .map((r) => (
                                <CommandItem
                                  key={r.url}
                                  value={r.url}
                                  onSelect={(value) => {
                                    setRepo(value)
                                    setBranch("")
                                    setRepoSearch("")
                                    setRepoPopoverOpen(false)
                                  }}
                                >
                                  <Check
                                    className={cn(
                                      "mr-2 h-4 w-4",
                                      repo === r.url ? "opacity-100" : "opacity-0"
                                    )}
                                  />
                                  <div className="flex flex-col min-w-0">
                                    <span className="text-sm truncate">{r.label}</span>
                                    <span className="text-xs text-muted-foreground font-mono truncate">
                                      {r.url}
                                    </span>
                                  </div>
                                </CommandItem>
                              ))}
                          </CommandGroup>
                        )}
                        {repoSearch.trim() && !linkedRepos.some((r) => r.url === repoSearch.trim()) && (
                          <CommandGroup heading="New repository">
                            <CommandItem
                              value={repoSearch.trim()}
                              onSelect={(value) => {
                                setRepo(value)
                                setBranch("")
                                setRepoSearch("")
                                setRepoPopoverOpen(false)
                              }}
                            >
                              <Plus className="mr-2 h-4 w-4" />
                              <span className="font-mono text-sm truncate">
                                {repoSearch.trim()}
                              </span>
                            </CommandItem>
                          </CommandGroup>
                        )}
                        {!repoSearch.trim() && linkedRepos.length === 0 && (
                          <CommandEmpty>Type a repository URL to get started</CommandEmpty>
                        )}
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">
                  Branch (optional, defaults to main)
                </Label>
                <Popover open={branchPopoverOpen} onOpenChange={setBranchPopoverOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      aria-expanded={branchPopoverOpen}
                      disabled={!trimmedRepo}
                      className="w-full justify-between text-sm h-9"
                    >
                      <span className={cn("truncate flex items-center gap-1.5", !branch && "text-muted-foreground")}>
                        {branch ? (
                          <>
                            <GitBranch className="h-3.5 w-3.5 shrink-0" />
                            {branch}
                          </>
                        ) : (
                          trimmedRepo ? "Select or enter a branch" : "Select a repository first"
                        )}
                      </span>
                      {isFetchingBranches ? (
                        <Loader2 className="ml-2 h-4 w-4 shrink-0 animate-spin opacity-50" />
                      ) : (
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="!w-[--radix-popover-trigger-width] p-0" align="start">
                    <Command shouldFilter={false}>
                      <CommandInput
                        placeholder="Search or type a new branch..."
                        value={branchSearch}
                        onValueChange={setBranchSearch}
                      />
                      <CommandList>
                        {filteredBranches.length > 0 && (
                          <CommandGroup heading="Remote branches">
                            {filteredBranches.map((b) => (
                              <CommandItem
                                key={b}
                                value={b}
                                onSelect={(value) => {
                                  setBranch(value)
                                  setBranchSearch("")
                                  setBranchPopoverOpen(false)
                                }}
                              >
                                <Check
                                  className={cn(
                                    "mr-2 h-4 w-4",
                                    branch === b ? "opacity-100" : "opacity-0"
                                  )}
                                />
                                <GitBranch className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" />
                                {b}
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        )}
                        {branchSearch.trim() && !remoteBranches.includes(branchSearch.trim()) && (
                          <CommandGroup heading="New branch">
                            <CommandItem
                              value={branchSearch.trim()}
                              onSelect={(value) => {
                                setBranch(value)
                                setBranchSearch("")
                                setBranchPopoverOpen(false)
                              }}
                            >
                              <Plus className="mr-2 h-4 w-4" />
                              <span className="text-sm truncate">
                                {branchSearch.trim()}
                              </span>
                            </CommandItem>
                          </CommandGroup>
                        )}
                        {isFetchingBranches && (
                          <div className="flex items-center justify-center gap-2 py-4 text-xs text-muted-foreground">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            Fetching branches...
                          </div>
                        )}
                        {!isFetchingBranches && remoteBranches.length === 0 && !branchSearch.trim() && (
                          <CommandEmpty>No branches found. Type a branch name.</CommandEmpty>
                        )}
                        {!isFetchingBranches && filteredBranches.length === 0 && branchSearch.trim() && remoteBranches.length > 0 && (
                          <CommandEmpty>No matching branches</CommandEmpty>
                        )}
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="provider-name" className="text-xs text-muted-foreground">
                  Display name (optional)
                </Label>
                <Input
                  id="provider-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Defaults to workspace ID"
                  className="text-sm"
                  onKeyDown={handleKeyDown}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="provider-context" className="text-xs text-muted-foreground">
                  Extra context (optional)
                </Label>
                <Input
                  id="provider-context"
                  value={context}
                  onChange={(e) => setContext(e.target.value)}
                  placeholder="Docker context, env vars, etc."
                  className="text-sm"
                  onKeyDown={handleKeyDown}
                />
              </div>

              {selectedProvider && repo.trim() && (
                <div className="space-y-1.5 rounded-md border bg-muted/30 px-3 py-2">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Terminal className="size-3" />
                    <span>Will run:</span>
                  </div>
                  <p className="font-mono text-xs break-all">
                    {(() => {
                      const toKebab = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
                      const repoName = repo.split("/").pop()?.replace(/\.git$/, "") || "workspace"
                      const derivedName = name.trim() || repoName
                      const branchVal = branch.trim() || "main"
                      const isDefaultBranch = branchVal === "main" || branchVal === "master"
                      const idSource = name.trim() || (!isDefaultBranch ? branchVal : repoName)
                      return selectedProvider.commands.create
                        .replaceAll("{binary}", selectedProvider.binaryPath)
                        .replaceAll("{repo}", repo.trim())
                        .replaceAll("{branch}", branchVal)
                        .replaceAll("{name}", derivedName)
                        .replaceAll("{id}", toKebab(idSource))
                        .replaceAll("{context}", context.trim())
                    })()}
                  </p>
                </div>
              )}

              <Button
                onClick={handleCreate}
                disabled={!canSubmit}
                className="w-full"
              >
                <Terminal className="mr-2 h-4 w-4" />
                Create Workspace
              </Button>
            </>
          )}

          {(isRunning || phase === "done" || phase === "error") && (
            <>
              <div className="flex flex-col gap-1 text-sm">
                <div className="flex items-center gap-2">
                  {isRunning && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                  {phase === "done" && <Check className="h-4 w-4 text-green-500" />}
                  {phase === "error" && <span className="h-4 w-4 text-destructive">✕</span>}
                  <span className={cn(
                    "text-muted-foreground",
                    phase === "done" && "text-green-500",
                    phase === "error" && "text-destructive"
                  )}>
                    {phase === "error" ? creationStore.errorMessage : creationStore.statusMessage}
                  </span>
                </div>
                {phase === "error" && (() => {
                  const lastStderr = [...creationStore.outputLines].reverse().find((l) => l.stream === "stderr")
                  return lastStderr ? (
                    <p className="text-xs text-amber-400 font-mono pl-6 break-all">
                      {lastStderr.data.trim()}
                    </p>
                  ) : null
                })()}
              </div>

              <div className="rounded-md border bg-black/90 p-3 font-mono text-xs text-green-400 max-h-[300px] overflow-y-auto">
                {creationStore.outputLines.length === 0 && isRunning && (
                  <span className="text-muted-foreground">Waiting for output...</span>
                )}
                {creationStore.outputLines.map((line, i) => (
                  <div
                    key={`${i}-${line.data.slice(0, 20)}`}
                    className="whitespace-pre-wrap break-all"
                  >
                    {line.data}
                  </div>
                ))}
                <div ref={outputEndRef} />
              </div>

              <div className="flex gap-2">
                {isRunning && (
                  <>
                    <Button
                      variant="outline"
                      onClick={() => creationStore.minimize()}
                      className="flex-1"
                    >
                      <Minus className="mr-2 h-4 w-4" />
                      Minimize
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={() => {
                        creationStore.abort()
                        resetFormState()
                        toast.info("Provider creation cancelled")
                      }}
                      className="flex-1"
                    >
                      Cancel
                    </Button>
                  </>
                )}
                {phase === "done" && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      creationStore.dismiss()
                      resetFormState()
                    }}
                    className="w-full"
                  >
                    Close
                  </Button>
                )}
                {phase === "error" && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      creationStore.dismiss()
                      setFormOpen(true)
                    }}
                    className="w-full"
                  >
                    Back to form
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
