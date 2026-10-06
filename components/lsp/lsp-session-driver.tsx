"use client";

import { useEffect, useRef } from "react";
import { useLspEnabledSetting } from "@/hooks/use-settings";
import { restoreBuiltinTypeScriptFeatures } from "@/lib/lsp/client/builtin-typescript";
import {
  connectLspSession,
  getRegisteredLspMonaco,
} from "@/lib/lsp/client/lsp-session";
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
  const controllerRef = useRef<LspSessionController | null>(null);

  useEffect(() => {
    return () => {
      controllerRef.current?.dispose();
      controllerRef.current = null;
    };
  }, []);

  useEffect(() => {
    controllerRef.current ??= createLspSessionController({
      fetchImpl: fetch,
      connect: connectLspSession,
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
      retryNonce,
    });
  }, [
    isLspEnabled,
    workspaceId,
    workspacePath,
    workspaceBackend,
    isMonacoRegistered,
    retryNonce,
  ]);

  return null;
}
