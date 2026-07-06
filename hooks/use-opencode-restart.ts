"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

interface RestartResult {
  restarted: boolean;
  target: "local" | "remote";
  killedCount?: number;
}

export function useOpencodeRestart(workspaceId: string | null) {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (): Promise<RestartResult> => {
      const query = workspaceId
        ? `?workspaceId=${encodeURIComponent(workspaceId)}`
        : "";
      const res = await fetch(`/api/opencode/restart${query}`, {
        method: "POST",
      });

      if (!res.ok) {
        const err = await res
          .json()
          .catch(() => ({ error: "Failed to restart opencode" }));
        const detail =
          typeof err === "object" && err !== null && "detail" in err
            ? (err as { detail?: string }).detail
            : undefined;
        const errorMessage =
          typeof err === "object" && err !== null && "error" in err
            ? (err as { error?: string }).error
            : undefined;
        throw new Error(
          [errorMessage, detail].filter(Boolean).join(": ") ||
            "Failed to restart opencode",
        );
      }

      return (await res.json()) as RestartResult;
    },
    onSuccess: (data) => {
      const killSuffix =
        data.killedCount && data.killedCount > 0
          ? ` (${data.killedCount} process${data.killedCount === 1 ? "" : "es"} killed)`
          : "";
      toast.success(`OpenCode restarted${killSuffix}`);

      if (workspaceId) {
        queryClient.invalidateQueries({
          queryKey: ["agent-health", workspaceId],
        });
      }
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  return {
    restart: mutation.mutate,
    isRestarting: mutation.isPending,
  };
}
