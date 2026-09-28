"use client";

import { Badge } from "@/components/ui/badge";
import { useWorkspaceEngine } from "@/hooks/use-workspace-engine";

interface WorkspaceEngineBadgeProps {
  workspaceId: string | null;
}

export function WorkspaceEngineBadge({
  workspaceId,
}: WorkspaceEngineBadgeProps) {
  const { engine, isLoading } = useWorkspaceEngine(workspaceId);

  if (isLoading || engine !== "omo") return null;

  return (
    <Badge
      variant="outline"
      className="text-muted-foreground px-1.5 py-0 font-mono text-[10px]"
      title="Chat engine: OmO Native"
    >
      omo
    </Badge>
  );
}
