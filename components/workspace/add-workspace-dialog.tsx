"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FolderSearch, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DirectoryBrowser } from "@/components/workspace/directory-browser";
import {
  useIsWorkspaceDialogOpen,
  useWorkspaceDialogStore,
} from "@/stores/workspace-dialog-store";

// Opens the one dialog that AddWorkspaceDialog renders.
export function AddWorkspaceButton() {
  return (
    <Button
      size="icon"
      className="sm:size-auto sm:px-3 sm:py-2"
      onClick={() =>
        useWorkspaceDialogStore.getState().open({ kind: "add-workspace" })
      }
    >
      <Plus className="h-4 w-4 sm:mr-2" />
      <span className="hidden sm:inline">Add Workspace</span>
    </Button>
  );
}

// Mounted once by the authenticated layout; opened through its store.
export function AddWorkspaceDialog() {
  const queryClient = useQueryClient();
  const isOpen = useIsWorkspaceDialogOpen("add-workspace");
  const [newPath, setNewPath] = useState("");
  const [newName, setNewName] = useState("");
  const [browseMode, setBrowseMode] = useState(true);

  function resetState() {
    setNewPath("");
    setNewName("");
    setBrowseMode(true);
  }

  const addMutation = useMutation({
    mutationFn: async (data: { name: string; path: string }) => {
      const res = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to add workspace");
      }
      return res.json();
    },
    onSuccess: (workspace) => {
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      useWorkspaceDialogStore.getState().close();
      resetState();
      toast.success(`Added workspace "${workspace.name}"`);
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  function handleAdd() {
    if (!newPath) return;
    addMutation.mutate({ name: newName, path: newPath });
  }

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (open) return;
        useWorkspaceDialogStore.getState().close();
        resetState();
      }}
    >
      <DialogContent className="sm:max-w-[550px]">
        <DialogHeader>
          <DialogTitle>
            {browseMode ? "Browse for Directory" : "Add Workspace"}
          </DialogTitle>
        </DialogHeader>
        {browseMode ? (
          <DirectoryBrowser
            onSelect={(selectedPath) => {
              setNewPath(selectedPath);
              const defaultName =
                selectedPath.split("/").filter(Boolean).pop() ?? "";
              setNewName(defaultName);
              setBrowseMode(false);
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
                  if (e.key === "Enter" && newPath) handleAdd();
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
  );
}
