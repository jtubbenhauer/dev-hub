import { resolveOmoAgentDir, resolveOmoSocketPath } from "@/lib/omo/agent-dir";
import { getOmoDialogLedger } from "@/lib/omo/facade/read-runtime";
import type { OmoReadWorkspace } from "@/lib/omo/facade/read-types";
import type { OmoWriteContext } from "@/lib/omo/facade/write-types";
import { getOmoRuntime } from "@/lib/omo/session-registry";
import { LocalFsSessionSource } from "@/lib/omo/session-source";

export function createOmoWriteContext(
  workspace: OmoReadWorkspace,
): OmoWriteContext {
  const agentDir = resolveOmoAgentDir();
  const runtime = getOmoRuntime(resolveOmoSocketPath(agentDir));
  return {
    runtime,
    source: new LocalFsSessionSource({
      agentDir,
      workspacePath: workspace.path,
    }),
    dialogs: getOmoDialogLedger(runtime),
    workspace,
  };
}
