import { resolveOmoAgentDir, resolveOmoSocketPath } from "@/lib/omo/agent-dir";
import { DialogLedger } from "@/lib/omo/dialog-ledger";
import { createOmoContext } from "@/lib/omo/runtime";
import { getOmoRuntime, type OmoRuntime } from "@/lib/omo/session-registry";
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

// Local-only host runtime accessor. Kept for call sites that have no
// specific workspace to scope to (the local /restart path); workspace-scoped
// reads must go through createOmoReadContext, which is backend-aware.
export function getOmoReadRuntime(): OmoRuntime {
  const agentDir = resolveOmoAgentDir();
  return getOmoRuntime(resolveOmoSocketPath(agentDir));
}

export function createOmoReadContext(
  workspace: OmoReadWorkspace,
): OmoReadContext {
  const { runtime, source } = createOmoContext(workspace);
  return { runtime, source, workspace };
}

export function getOmoDialogLedger(runtime: OmoRuntime): DialogLedger {
  if (runtime.dialogLedger !== undefined) return runtime.dialogLedger;
  const existing = runtime.dialogs.get(DIALOG_LEDGER_KEY);
  if (isDialogLedger(existing)) return existing;
  const ledger = new DialogLedger();
  runtime.dialogs.set(DIALOG_LEDGER_KEY, ledger);
  return ledger;
}
