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

export interface UpgradedEndpoints {
  opencode: string;
  agent: string;
}

// `rig-cli upgrade --json` prints only a JSON array of
// { id, status, endpoints? } on stdout; progress goes to stderr.
export function parseUpgradeJsonOutput(stdout: string): unknown[] | null {
  try {
    const parsed: unknown = JSON.parse(stdout);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function findUpgradedEndpoints(
  upgradeResults: unknown[],
  providerWorkspaceId: string,
): UpgradedEndpoints | null {
  for (const result of upgradeResults) {
    if (!result || typeof result !== "object") continue;
    const { id, endpoints } = result as Record<string, unknown>;
    if (id !== providerWorkspaceId) continue;
    if (!endpoints || typeof endpoints !== "object") return null;
    const { opencode, agent } = endpoints as Record<string, unknown>;
    if (typeof opencode !== "string" || typeof agent !== "string") {
      return null;
    }
    return { opencode, agent };
  }
  return null;
}
