import type { Workspace, WorkspaceProvider } from "@/types";

/**
 * Check if a workspace can be resumed (auto-suspended).
 * Returns true when:
 * - workspace.backend === "remote"
 * - workspace.providerMeta is not null
 * - the provider matched via providerMeta.providerId has behaviour?.supportsAutoSuspend === true
 * - that provider has a commands.start defined (non-empty string)
 */
export function canResume(
  workspace: Workspace,
  providers: WorkspaceProvider[],
): boolean {
  // Must be a remote workspace
  if (workspace.backend !== "remote") {
    return false;
  }

  // Must have provider metadata
  if (!workspace.providerMeta) {
    return false;
  }

  // Extract providerId from providerMeta
  const providerMeta = workspace.providerMeta as Record<string, unknown>;
  const providerId = providerMeta.providerId as string | undefined;

  if (!providerId) {
    return false;
  }

  // Find the provider
  const provider = providers.find((p) => p.id === providerId);
  if (!provider) {
    return false;
  }

  // Provider must support auto-suspend
  if (!provider.behaviour?.supportsAutoSuspend) {
    return false;
  }

  // Provider must have a start command defined
  if (!provider.commands.start) {
    return false;
  }

  return true;
}

/**
 * Interpolate placeholders in a provider command template.
 * Replaces:
 * - {binary} → provider.binaryPath
 * - {id} → workspace.providerMeta.providerWorkspaceId (with fallback to empty string)
 * - {name} → workspace.name
 */
export function interpolateProviderCommand(
  template: string,
  workspace: Workspace,
  provider: WorkspaceProvider,
): string {
  let result = template;

  // Replace {binary}
  result = result.replaceAll("{binary}", provider.binaryPath);

  // Replace {name}
  result = result.replaceAll("{name}", workspace.name);

  // Replace {id} with providerWorkspaceId from providerMeta
  const providerWorkspaceId =
    workspace.providerMeta &&
    typeof workspace.providerMeta === "object" &&
    "providerWorkspaceId" in workspace.providerMeta
      ? (workspace.providerMeta.providerWorkspaceId as string)
      : "";
  result = result.replaceAll("{id}", providerWorkspaceId);

  return result;
}
