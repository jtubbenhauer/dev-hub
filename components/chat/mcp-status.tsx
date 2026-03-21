"use client";

import { memo } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useMcpStatus, type McpStatusValue } from "@/hooks/use-mcp";

function statusDotColor(status: McpStatusValue["status"]): string {
  switch (status) {
    case "connected":
      return "bg-emerald-500";
    case "failed":
    case "needs_client_registration":
      return "bg-red-500";
    case "needs_auth":
      return "bg-yellow-500";
    case "disabled":
      return "bg-muted-foreground/40";
  }
}

function statusLabel(entry: McpStatusValue): string {
  switch (entry.status) {
    case "connected":
      return "Connected";
    case "disabled":
      return "Disabled";
    case "failed":
      return entry.error;
    case "needs_auth":
      return "Needs authentication";
    case "needs_client_registration":
      return entry.error;
  }
}

const McpServerRow = memo(function McpServerRow({
  name,
  value,
}: {
  name: string;
  value: McpStatusValue;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex items-center gap-2 rounded px-1.5 py-1 text-xs">
          <span
            className={`size-1.5 shrink-0 rounded-full ${statusDotColor(value.status)}`}
          />
          <span className="flex-1 truncate">{name}</span>
        </div>
      </TooltipTrigger>
      <TooltipContent side="left" className="text-xs">
        {statusLabel(value)}
      </TooltipContent>
    </Tooltip>
  );
});

export const McpStatusPanel = memo(function McpStatusPanel() {
  const { data: mcpStatus, isLoading } = useMcpStatus();

  if (isLoading || !mcpStatus) return null;

  const entries = Object.entries(mcpStatus).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  if (entries.length === 0) return null;

  const connectedCount = entries.filter(
    ([, v]) => v.status === "connected",
  ).length;
  const errorCount = entries.filter(
    ([, v]) =>
      v.status === "failed" ||
      v.status === "needs_auth" ||
      v.status === "needs_client_registration",
  ).length;

  return (
    <div className="space-y-2">
      <div className="text-muted-foreground flex items-center gap-2 text-xs">
        <span>
          {connectedCount}/{entries.length} active
        </span>
        {errorCount > 0 && (
          <span className="text-red-500">
            {errorCount} error{errorCount !== 1 ? "s" : ""}
          </span>
        )}
      </div>
      <div className="space-y-0.5">
        {entries.map(([name, value]) => (
          <McpServerRow key={name} name={name} value={value} />
        ))}
      </div>
    </div>
  );
});
