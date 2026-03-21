"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { AuthenticatedLayout } from "@/components/layout/authenticated-layout";
import { TerminalPanel } from "@/components/terminal/terminal-panel";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { Loader2, TerminalSquare, AlertCircle } from "lucide-react";

interface TerminalConfig {
  wsUrl: string;
  cwd: string;
  shellCommand: string | null;
}

function TerminalPageContent() {
  const searchParams = useSearchParams();
  const workspaceIdParam = searchParams.get("workspace");
  const { activeWorkspaceId, activeWorkspace, workspaces } =
    useWorkspaceStore();
  const workspaceId = workspaceIdParam || activeWorkspaceId;
  const workspace = workspaceIdParam
    ? (workspaces.find((w) => w.id === workspaceIdParam) ?? activeWorkspace)
    : activeWorkspace;

  const [config, setConfig] = useState<TerminalConfig | null>(null);
  const [error, setError] = useState<string | null>(() =>
    workspaceId
      ? null
      : "No workspace selected. Go to Workspaces and open a terminal from there.",
  );
  const [isLoading, setIsLoading] = useState(() => !!workspaceId);
  const [resolvedWorkspaceId, setResolvedWorkspaceId] = useState<string | null>(
    null,
  );

  // Detect workspace change during render and reset to loading state
  if (workspaceId && workspaceId !== resolvedWorkspaceId) {
    setIsLoading(true);
    setError(null);
    setConfig(null);
    setResolvedWorkspaceId(workspaceId);
  }

  useEffect(() => {
    if (!workspaceId || !isLoading) return;

    let cancelled = false;

    fetch(
      `/api/terminal/resolve?workspaceId=${encodeURIComponent(workspaceId)}`,
    )
      .then(async (res) => {
        if (!res.ok) {
          const body = (await res.json()) as { error?: string };
          throw new Error(
            body.error || `Failed to resolve terminal config (${res.status})`,
          );
        }
        return res.json() as Promise<TerminalConfig>;
      })
      .then((data) => {
        if (!cancelled) {
          setConfig(data);
          setIsLoading(false);
        }
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setError(err.message);
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [workspaceId, isLoading]);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="text-muted-foreground size-6 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex max-w-md flex-col items-center gap-3 text-center">
          <AlertCircle className="text-muted-foreground size-10" />
          <p className="text-muted-foreground text-sm">{error}</p>
        </div>
      </div>
    );
  }

  if (!config) return null;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b px-4 py-2">
        <TerminalSquare className="text-muted-foreground size-4" />
        <span className="text-sm font-medium">
          {workspace?.name ?? "Terminal"}
        </span>
        {workspace?.backend === "remote" && (
          <span className="text-xs text-blue-500">(remote)</span>
        )}
        <span className="text-muted-foreground ml-auto max-w-96 truncate font-mono text-xs">
          {config.shellCommand || config.cwd}
        </span>
      </div>
      <div className="min-h-0 flex-1">
        <TerminalPanel
          wsUrl={config.wsUrl}
          workspaceId={workspaceId!}
          cwd={config.cwd}
          shellCommand={config.shellCommand}
        />
      </div>
    </div>
  );
}

export default function TerminalPage() {
  return (
    <AuthenticatedLayout>
      <Suspense
        fallback={
          <div className="flex h-full items-center justify-center">
            <Loader2 className="text-muted-foreground size-6 animate-spin" />
          </div>
        }
      >
        <TerminalPageContent />
      </Suspense>
    </AuthenticatedLayout>
  );
}
