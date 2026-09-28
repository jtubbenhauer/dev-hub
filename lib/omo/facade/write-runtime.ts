import { getOmoDialogLedger } from "@/lib/omo/facade/read-runtime";
import type { OmoReadWorkspace } from "@/lib/omo/facade/read-types";
import type { OmoWriteContext } from "@/lib/omo/facade/write-types";
import { createOmoContext } from "@/lib/omo/runtime";

export function createOmoWriteContext(
  workspace: OmoReadWorkspace,
): OmoWriteContext {
  const { runtime, source } = createOmoContext(workspace);
  return {
    runtime,
    source,
    dialogs: getOmoDialogLedger(runtime),
    workspace,
  };
}
