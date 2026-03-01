"use client"

import { useState, useEffect } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { AuthenticatedLayout } from "@/components/layout/authenticated-layout"
import { useWorkspaceStore } from "@/stores/workspace-store"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Card,
  CardContent,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  FolderGit2,
  Plus,
  FolderSearch,
} from "lucide-react"
import { DirectoryBrowser } from "@/components/workspace/directory-browser"
import { WorkspaceCard } from "@/components/workspace/workspace-card"
import { CreateWorktreeDialog } from "@/components/workspace/create-worktree-dialog"
import { CloneRepoDialog } from "@/components/workspace/clone-repo-dialog"
import { toast } from "sonner"
import type { Workspace } from "@/types"

export default function WorkspacesPage() {
  const queryClient = useQueryClient()
  const { setWorkspaces } = useWorkspaceStore()
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [newPath, setNewPath] = useState("")
  const [newName, setNewName] = useState("")
  const [browseMode, setBrowseMode] = useState(true)

  const { data: workspaces = [] } = useQuery<Workspace[]>({
    queryKey: ["workspaces"],
    queryFn: async () => {
      const res = await fetch("/api/workspaces")
      if (!res.ok) throw new Error("Failed to fetch")
      return res.json()
    },
  })

  useEffect(() => {
    if (workspaces.length > 0) setWorkspaces(workspaces)
  }, [workspaces, setWorkspaces])

  const addMutation = useMutation({
    mutationFn: async (data: { name: string; path: string }) => {
      const res = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || "Failed to add workspace")
      }
      return res.json()
    },
    onSuccess: (workspace) => {
      queryClient.invalidateQueries({ queryKey: ["workspaces"] })
      setAddDialogOpen(false)
      setNewPath("")
      setNewName("")
      setBrowseMode(true)
      toast.success(`Added workspace "${workspace.name}"`)
    },
    onError: (err: Error) => {
      toast.error(err.message)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/workspaces/${id}`, { method: "DELETE" })
      if (!res.ok) throw new Error("Failed to delete")
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspaces"] })
      toast.success("Workspace removed")
    },
    onError: () => {
      toast.error("Failed to remove workspace")
    },
  })

  function handleAdd() {
    if (!newPath) return
    addMutation.mutate({ name: newName, path: newPath })
  }

  return (
    <AuthenticatedLayout>
      <div className="flex min-h-0 flex-1 flex-col overflow-auto p-4 md:p-6">
        <div className="flex shrink-0 items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">Workspaces</h1>
          <div className="flex items-center gap-2">
            <CloneRepoDialog />
            <CreateWorktreeDialog workspaces={workspaces} />
            <Dialog open={addDialogOpen} onOpenChange={(open) => {
              setAddDialogOpen(open)
              if (!open) {
                setNewPath("")
                setNewName("")
                setBrowseMode(true)
              }
            }}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                Add Workspace
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[550px]">
              <DialogHeader>
                <DialogTitle>
                  {browseMode ? "Browse for Directory" : "Add Workspace"}
                </DialogTitle>
              </DialogHeader>
              {browseMode ? (
                <DirectoryBrowser
                  onSelect={(selectedPath) => {
                    setNewPath(selectedPath)
                    const defaultName = selectedPath.split("/").filter(Boolean).pop() ?? ""
                    setNewName(defaultName)
                    setBrowseMode(false)
                  }}
                />
              ) : (
                <div className="space-y-4 pt-2">
                  <div className="space-y-2">
                    <Label htmlFor="path">Directory Path</Label>
                    <div className="flex gap-2">
                      <Input
                        id="path"
                        value={newPath}
                        onChange={(e) => setNewPath(e.target.value)}
                        placeholder="/home/user/dev/my-project"
                        className="font-mono text-sm"
                      />
                      <Button
                        variant="outline"
                        size="icon"
                        className="shrink-0"
                        onClick={() => setBrowseMode(true)}
                        title="Browse directories"
                      >
                        <FolderSearch className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="name">Display Name</Label>
                    <Input
                      id="name"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      placeholder="Defaults to directory name"
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && newPath) handleAdd()
                      }}
                    />
                  </div>
                  <Button
                    onClick={handleAdd}
                    disabled={addMutation.isPending || !newPath}
                    className="w-full"
                  >
                    {addMutation.isPending ? "Adding..." : "Add Workspace"}
                  </Button>
                </div>
              )}
            </DialogContent>
          </Dialog>
          </div>
        </div>

        {workspaces.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-4 py-12">
              <FolderGit2 className="h-16 w-16 text-muted-foreground" />
              <p className="text-lg text-muted-foreground">
                No workspaces registered yet
              </p>
              <p className="text-sm text-muted-foreground">
                Add a directory from your filesystem, clone a repo, or create a worktree to get started
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {workspaces.map((workspace) => (
              <WorkspaceCard
                key={workspace.id}
                workspace={workspace}
                onDelete={(id) => deleteMutation.mutate(id)}
                isDeleting={deleteMutation.isPending}
              />
            ))}
          </div>
        )}
      </div>
    </AuthenticatedLayout>
  )
}
