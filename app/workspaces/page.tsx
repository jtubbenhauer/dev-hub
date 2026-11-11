"use client";

import { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AuthenticatedLayout } from "@/components/layout/authenticated-layout";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { FolderGit2, Palette } from "lucide-react";
import { WorkspaceCard } from "@/components/workspace/workspace-card";
import { AddWorkspaceButton } from "@/components/workspace/add-workspace-dialog";
import { CreateWorktreeButton } from "@/components/workspace/create-worktree-dialog";
import { CloneRepoButton } from "@/components/workspace/clone-repo-dialog";
import { ConnectRemoteButton } from "@/components/workspace/connect-remote-dialog";
import { CreateProviderWorkspaceDialog } from "@/components/workspace/create-provider-workspace-dialog";
import { toast } from "sonner";
import type { Workspace } from "@/types";
import { assignColorsToUncolored } from "@/lib/workspace-color-utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export default function WorkspacesPage() {
  const queryClient = useQueryClient();
  const { setWorkspaces } = useWorkspaceStore();

  const { data: workspaces = [], isLoading } = useQuery<Workspace[]>({
    queryKey: ["workspaces"],
    queryFn: async () => {
      const res = await fetch("/api/workspaces");
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  useEffect(() => {
    if (workspaces.length > 0) setWorkspaces(workspaces);
  }, [workspaces, setWorkspaces]);

  const deleteMutation = useMutation({
    mutationFn: async ({
      id,
      destroyProvider,
    }: {
      id: string;
      destroyProvider?: boolean;
    }) => {
      const params = new URLSearchParams();
      if (destroyProvider) params.set("destroyProvider", "true");
      const query = params.toString();
      const res = await fetch(
        `/api/workspaces/${id}${query ? `?${query}` : ""}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error("Failed to delete");
      return res.json() as Promise<{
        deleted: boolean;
        worktreeRemoveError?: string;
        providerDestroyError?: string;
      }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      if (data.worktreeRemoveError) {
        toast.warning(
          `Workspace removed, but worktree cleanup failed: ${data.worktreeRemoveError}`,
        );
      } else if (data.providerDestroyError) {
        toast.warning(
          `Workspace removed, but provider destroy failed: ${data.providerDestroyError}`,
        );
      } else {
        toast.success("Workspace removed");
      }
    },
    onError: () => {
      toast.error("Failed to remove workspace");
    },
  });

  const uncoloredCount = workspaces.filter((ws) => !ws.color).length;

  const bulkColorMutation = useMutation({
    mutationFn: async () => {
      const assignments = assignColorsToUncolored(workspaces);
      const updates = Array.from(assignments.entries()).map(([id, color]) =>
        fetch(`/api/workspaces/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ color }),
        }).then((res) => {
          if (!res.ok) throw new Error(`Failed to update workspace ${id}`);
        }),
      );
      await Promise.all(updates);
      return assignments.size;
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      toast.success(
        `Assigned colors to ${count} workspace${count === 1 ? "" : "s"}`,
      );
    },
    onError: () => {
      toast.error("Failed to assign colors");
    },
  });

  return (
    <AuthenticatedLayout>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto p-4 md:p-6">
        <div className="mb-6 flex shrink-0 items-center justify-between">
          <h1 className="text-2xl font-bold">Workspaces</h1>
          <div className="flex items-center gap-2">
            {uncoloredCount > 0 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => bulkColorMutation.mutate()}
                    disabled={bulkColorMutation.isPending}
                  >
                    <Palette className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  Assign colors to {uncoloredCount} uncolored workspace
                  {uncoloredCount === 1 ? "" : "s"}
                </TooltipContent>
              </Tooltip>
            )}
            <CloneRepoButton />
            <ConnectRemoteButton />
            <CreateProviderWorkspaceDialog workspaces={workspaces} />
            <CreateWorktreeButton />
            <AddWorkspaceButton />
          </div>
        </div>

        {isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Card key={i} className="overflow-hidden">
                <CardContent className="space-y-3 pt-4">
                  <div className="flex items-center justify-between">
                    <Skeleton className="h-5 w-32" />
                    <Skeleton className="h-5 w-14 rounded-full" />
                  </div>
                  <Skeleton className="h-3.5 w-48" />
                  <div className="space-y-1.5">
                    <Skeleton className="h-3.5 w-28" />
                    <Skeleton className="h-3.5 w-44" />
                  </div>
                  <div className="flex gap-4 pt-1">
                    <Skeleton className="h-3.5 w-10" />
                    <Skeleton className="h-3.5 w-10" />
                    <Skeleton className="h-3.5 w-10" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : workspaces.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-4 py-12">
              <FolderGit2 className="text-muted-foreground h-16 w-16" />
              <p className="text-muted-foreground text-lg">
                No workspaces registered yet
              </p>
              <p className="text-muted-foreground text-sm">
                Add a directory from your filesystem, clone a repo, or create a
                worktree to get started
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {workspaces.map((workspace) => (
              <WorkspaceCard
                key={workspace.id}
                workspace={workspace}
                onDelete={(id, destroyProvider) =>
                  deleteMutation.mutate({ id, destroyProvider })
                }
                isDeleting={deleteMutation.isPending}
              />
            ))}
          </div>
        )}
      </div>
    </AuthenticatedLayout>
  );
}
