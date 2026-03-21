import {
  Workspace,
  ProviderBehaviour,
  DEFAULT_PROVIDER_BEHAVIOUR,
} from "@/types";

export function getWorkspaceBehaviour(workspace: Workspace): ProviderBehaviour {
  const meta = workspace.providerMeta as Record<string, unknown> | null;
  if (!meta || !("behaviour" in meta)) {
    return DEFAULT_PROVIDER_BEHAVIOUR;
  }
  return {
    ...DEFAULT_PROVIDER_BEHAVIOUR,
    ...(meta.behaviour as Partial<ProviderBehaviour>),
  };
}

export function shouldSSEConnect(
  workspace: Workspace,
  activeWorkspaceId: string | null,
): boolean {
  if (workspace.backend !== "remote") {
    return true;
  }
  if (workspace.id === activeWorkspaceId) {
    return true;
  }
  return getWorkspaceBehaviour(workspace).sseWhenInactive;
}
