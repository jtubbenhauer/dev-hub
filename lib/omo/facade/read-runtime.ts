import { resolveOmoAgentDir, resolveOmoSocketPath } from "@/lib/omo/agent-dir";
import { DialogLedger } from "@/lib/omo/dialog-ledger";
import { getOmoRuntime, type OmoRuntime } from "@/lib/omo/session-registry";
import {
  LocalFsSessionSource,
  type SessionSource,
} from "@/lib/omo/session-source";
import type {
  OmoReadContext,
  OmoReadWorkspace,
} from "@/lib/omo/facade/read-types";

const DIALOG_LEDGER_KEY = "\u0000devhub-omo-dialog-ledger";

function isDialogLedger(value: unknown): value is DialogLedger {
  return (
    typeof value === "object" &&
    value !== null &&
    "register" in value &&
    typeof value.register === "function" &&
    "requestsForWorkspace" in value &&
    typeof value.requestsForWorkspace === "function"
  );
}

export function getOmoReadRuntime(): OmoRuntime {
  const agentDir = resolveOmoAgentDir();
  return getOmoRuntime(resolveOmoSocketPath(agentDir));
}

export function createOmoReadSessionSource(
  workspace: OmoReadWorkspace,
): SessionSource {
  return new LocalFsSessionSource({
    agentDir: resolveOmoAgentDir(),
    workspacePath: workspace.path,
  });
}

export function createOmoReadContext(
  workspace: OmoReadWorkspace,
): OmoReadContext {
  return {
    runtime: getOmoReadRuntime(),
    source: createOmoReadSessionSource(workspace),
    workspace,
  };
}

export function getOmoDialogLedger(runtime: OmoRuntime): DialogLedger {
  const existing = runtime.dialogs.get(DIALOG_LEDGER_KEY);
  if (isDialogLedger(existing)) return existing;
  const ledger = new DialogLedger();
  runtime.dialogs.set(DIALOG_LEDGER_KEY, ledger);
  return ledger;
}
