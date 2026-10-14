import type { ChatEngine } from "@/lib/engine/types";
import { isTrustedAgentOrigin } from "@/lib/workspaces/agent-origin";
import type { Workspace } from "@/types";

type WorkspaceEngineTarget = Pick<
  Workspace,
  "backend" | "opencodeUrl" | "agentUrl"
>;

// Local workspaces can always reach both engines. A remote workspace reaches
// OpenCode only when it has both URLs getBackend requires, and omo only
// through a trusted devhub-agent sidecar.
export function canWorkspaceRunEngine(
  workspace: WorkspaceEngineTarget,
  engine: ChatEngine,
): boolean {
  if (workspace.backend !== "remote") return true;
  if (!workspace.agentUrl) return false;
  if (engine === "opencode") return Boolean(workspace.opencodeUrl);
  return isTrustedAgentOrigin(workspace.agentUrl);
}
