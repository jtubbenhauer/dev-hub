"use client";

import { useLayoutEffect, useRef } from "react";
import { MoveToFileDialog } from "@/components/lsp/move-to-file-dialog";
import { useLspEnabledSetting } from "@/hooks/use-settings";
import {
  restoreBuiltinTypeScriptFeatures,
  suppressBuiltinTypeScriptFeatures,
} from "@/lib/lsp/client/builtin-typescript";
import {
  getLspSessionConnector,
  getRegisteredLspMonaco,
  type LspSessionConnector,
} from "@/lib/lsp/client/lsp-session-registry";
import {
  createLspSessionController,
  type LspSessionController,
} from "@/lib/lsp/client/session-controller";
import { useLspStore } from "@/stores/lsp-store";
import { useWorkspaceStore } from "@/stores/workspace-store";

function restoreBuiltinIfRegistered(): void {
  const monaco = getRegisteredLspMonaco();
  if (monaco) restoreBuiltinTypeScriptFeatures(monaco);
}

// The connector is registered with Monaco, so pages without an editor never load the LSP runtime.
const connectThroughRegisteredConnector: LspSessionConnector = (options) => {
  const connect = getLspSessionConnector();
  return connect
    ? connect(options)
    : Promise.reject(new Error("LSP session runtime is not loaded"));
};

export function LspSessionDriver() {
  const { isLspEnabled } = useLspEnabledSetting();
  const workspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const workspacePath = useWorkspaceStore(
    (s) =>
      s.workspaces.find((workspace) => workspace.id === s.activeWorkspaceId)
        ?.path ?? null,
  );
  const workspaceBackend = useWorkspaceStore(
    (s) =>
      s.workspaces.find((workspace) => workspace.id === s.activeWorkspaceId)
        ?.backend ?? null,
  );
  const isMonacoRegistered = useLspStore((s) => s.isMonacoRegistered);
  const retryNonce = useLspStore((s) => s.retryNonce);
  const hasAttachedEditor = useLspStore(
    (s) => Object.keys(s.documentOwners).length > 0,
  );
  const controllerRef = useRef<LspSessionController | null>(null);

  useLayoutEffect(() => {
    const unsubscribe = useLspStore.subscribe((state, previous) => {
      if (state.status !== "starting" || previous.status === "starting") return;
      const monaco = getRegisteredLspMonaco();
      if (monaco) suppressBuiltinTypeScriptFeatures(monaco);
    });
    return () => {
      unsubscribe();
      controllerRef.current?.dispose();
      controllerRef.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    controllerRef.current ??= createLspSessionController({
      fetchImpl: fetch,
      connect: connectThroughRegisteredConnector,
      restoreBuiltin: restoreBuiltinIfRegistered,
    });
    const workspace =
      workspaceId !== null &&
      workspacePath !== null &&
      workspaceBackend !== null
        ? { id: workspaceId, path: workspacePath, backend: workspaceBackend }
        : null;
    controllerRef.current.update({
      isLspEnabled,
      workspace,
      isMonacoRegistered,
      hasAttachedEditor,
      retryNonce,
    });
  }, [
    isLspEnabled,
    workspaceId,
    workspacePath,
    workspaceBackend,
    isMonacoRegistered,
    hasAttachedEditor,
    retryNonce,
  ]);

  return <MoveToFileDialog />;
}
