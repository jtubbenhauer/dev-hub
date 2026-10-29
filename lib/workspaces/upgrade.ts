import type { Workspace, WorkspaceProvider } from "@/types";

export function getProviderUpgradeCommand(
  workspace: Workspace,
  providers: WorkspaceProvider[],
): string | undefined {
  if (workspace.backend !== "remote" || !workspace.providerMeta) {
    return undefined;
  }
  const providerId = (workspace.providerMeta as Record<string, unknown>)
    .providerId;
  if (typeof providerId !== "string") return undefined;
  const provider = providers.find((candidate) => candidate.id === providerId);
  const upgradeCommand = provider?.commands.upgrade?.trim();
  return upgradeCommand ? upgradeCommand : undefined;
}

export function lastOutputLines(output: string, lineCount: number): string {
  return output.trim().split("\n").slice(-lineCount).join("\n");
}
