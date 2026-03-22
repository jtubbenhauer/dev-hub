"use client";

import { useCallback, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

const resumingWorkspaces = new Set<string>();

type ResumeResult = { status: "started" } | { status: "already-starting" };

export function useWorkspaceResume(workspaceId: string | null) {
  const queryClient = useQueryClient();
  const [isResuming, setIsResuming] = useState(false);

  const resumeMutation = useMutation({
    mutationFn: async (): Promise<ResumeResult> => {
      const res = await fetch(`/api/workspaces/${workspaceId}/start`, {
        method: "POST",
      });

      if (res.status === 409) {
        return { status: "already-starting" };
      }

      if (!res.ok) {
        const err = await res
          .json()
          .catch(() => ({ error: "Failed to resume workspace" }));
        throw new Error(err.error || "Failed to resume workspace");
      }

      return { status: "started" };
    },
    onSuccess: (data) => {
      if (data.status === "already-starting") return;

      queryClient.invalidateQueries({
        queryKey: ["agent-health", workspaceId],
      });
      toast.success("Workspace resumed");
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
    onSettled: () => {
      if (workspaceId) {
        resumingWorkspaces.delete(workspaceId);
      }
      setIsResuming(false);
    },
  });

  const resume = useCallback(() => {
    if (!workspaceId || resumingWorkspaces.has(workspaceId)) return;

    resumingWorkspaces.add(workspaceId);
    setIsResuming(true);
    toast.success("Resuming workspace...");
    resumeMutation.mutate();
  }, [workspaceId, resumeMutation]);

  return { isResuming, resume };
}
