"use client";

import { useProviderCreationStore } from "@/stores/provider-creation-store";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export function ProviderCreationIndicator() {
  const phase = useProviderCreationStore((s) => s.phase);
  const providerName = useProviderCreationStore((s) => s.providerName);
  const expand = useProviderCreationStore((s) => s.expand);

  if (phase === "idle") return null;

  const tooltipText =
    phase === "running"
      ? `Creating workspace via ${providerName}...`
      : phase === "done"
        ? "Workspace created successfully"
        : "Workspace creation failed";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "relative",
            phase === "done" && "text-green-500 hover:text-green-600",
            phase === "error" && "text-destructive hover:text-destructive",
          )}
          onClick={expand}
        >
          {phase === "running" && <Loader2 className="h-4 w-4 animate-spin" />}
          {phase === "done" && <CheckCircle2 className="h-4 w-4" />}
          {phase === "error" && <XCircle className="h-4 w-4" />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{tooltipText}</TooltipContent>
    </Tooltip>
  );
}
