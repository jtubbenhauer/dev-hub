import { useCallback, useLayoutEffect, useRef } from "react";
import type * as Monaco from "monaco-editor";
import { useLspEnabledSetting } from "@/hooks/use-settings";
import { isLspDocumentPath } from "@/lib/lsp/document-scope";
import { useLspStore } from "@/stores/lsp-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import {
  suppressBuiltinTypeScriptFeatures,
  trackBuiltinTs,
} from "@/lib/lsp/client/builtin-typescript";

export function useBuiltinTypeScriptGate({
  workspaceId,
  filePath,
  isLspEligible,
}: {
  readonly workspaceId: string | undefined;
  readonly filePath: string | undefined;
  readonly isLspEligible: boolean | undefined;
}) {
  const { isLspEnabled, isLoading } = useLspEnabledSetting();
  const isLocalActiveWorkspace = useWorkspaceStore(
    (state) =>
      state.activeWorkspaceId === workspaceId &&
      state.workspaces.some(
        (workspace) =>
          workspace.id === workspaceId && workspace.backend === "local",
      ),
  );
  const hasLspIntent = Boolean(
    isLspEligible &&
    isLspEnabled &&
    isLocalActiveWorkspace &&
    filePath &&
    isLspDocumentPath(filePath),
  );
  const monacoRef = useRef<typeof Monaco | null>(null);
  const intentRef = useRef(hasLspIntent);
  const prepareMonaco = useCallback((monaco: typeof Monaco) => {
    monacoRef.current = monaco;
    trackBuiltinTs(monaco);
    // Read at the model boundary, not from a possibly stale async-loader render.
    const { status } = useLspStore.getState();
    if (intentRef.current && status !== "error" && status !== "busy") {
      suppressBuiltinTypeScriptFeatures(monaco);
    }
  }, []);

  useLayoutEffect(() => {
    intentRef.current = hasLspIntent;
    if (monacoRef.current) prepareMonaco(monacoRef.current);
  }, [hasLspIntent, prepareMonaco]);

  return {
    isReady: !isLspEligible || !isLoading,
    prepareMonaco,
  };
}
