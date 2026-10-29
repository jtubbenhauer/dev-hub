import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useWorkspaceProviders } from "@/hooks/use-settings";
import { getProviderUpgradeCommand } from "@/lib/workspaces/upgrade";
import type { Workspace } from "@/types";

interface UpgradeResponse {
  status?: string;
  summary?: string;
  error?: string;
}

export function useWorkspaceUpgrade(workspace: Workspace): {
  canUpgrade: boolean;
  isUpgrading: boolean;
  upgrade: () => void;
} {
  const queryClient = useQueryClient();
  const { providers } = useWorkspaceProviders();
  const canUpgrade =
    getProviderUpgradeCommand(workspace, providers) !== undefined;

  const mutation = useMutation({
    mutationFn: async (): Promise<UpgradeResponse> => {
      const response = await fetch(`/api/workspaces/${workspace.id}/upgrade`, {
        method: "POST",
      });
      const body = (await response.json()) as UpgradeResponse;
      if (!response.ok) {
        throw new Error(body.error || "Upgrade failed");
      }
      return body;
    },
    onMutate: () => toast.loading(`Upgrading ${workspace.name}...`),
    onSuccess: (body, _variables, toastId) => {
      toast.success(body.summary || `Upgraded ${workspace.name}`, {
        id: toastId,
      });
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
    },
    onError: (error: Error, _variables, toastId) => {
      toast.error(`Upgrade failed: ${error.message}`, { id: toastId });
    },
  });

  return {
    canUpgrade,
    isUpgrading: mutation.isPending,
    upgrade: () => mutation.mutate(),
  };
}
