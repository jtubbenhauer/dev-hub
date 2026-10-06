"use client";

import { RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  SETTINGS_KEYS,
  useLspEnabledSetting,
  useSettingsMutation,
} from "@/hooks/use-settings";
import type { LspClientStatus } from "@/lib/lsp/types";
import { cn } from "@/lib/utils";
import { useLspStore } from "@/stores/lsp-store";

const STATUS_DOT_CLASSES: Record<LspClientStatus, string> = {
  disabled: "bg-muted-foreground/40",
  unavailable: "bg-muted-foreground/40",
  "waiting-for-editor": "bg-yellow-500",
  starting: "bg-yellow-500",
  connecting: "bg-yellow-500",
  connected: "bg-green-500",
  busy: "bg-orange-500",
  error: "bg-destructive",
};

const STATUS_TOOLTIPS: Record<Exclude<LspClientStatus, "error">, string> = {
  disabled: "Off — click to enable",
  unavailable: "Needs a local workspace",
  "waiting-for-editor": "Waiting for an editor",
  starting: "Starting…",
  connecting: "Connecting…",
  connected: "Connected",
  busy: "In use in another tab",
};

function statusTooltip(
  status: LspClientStatus,
  errorMessage: string | null,
): string {
  if (status === "error") return `Error: ${errorMessage ?? "Unknown error"}`;
  return STATUS_TOOLTIPS[status];
}

export function LspStatusToggle() {
  const status = useLspStore((s) => s.status);
  const errorMessage = useLspStore((s) => s.errorMessage);
  const { isLspEnabled } = useLspEnabledSetting();
  const mutation = useSettingsMutation();
  const tooltipText = statusTooltip(status, errorMessage);

  return (
    <div className="flex items-center">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 px-1.5 text-xs"
            data-testid="lsp-status-toggle"
            data-lsp-status={status}
            aria-label={`TypeScript language server: ${tooltipText}`}
            onClick={() =>
              mutation.mutate({
                key: SETTINGS_KEYS.LSP_ENABLED,
                value: !isLspEnabled,
              })
            }
          >
            <span
              aria-hidden="true"
              data-testid="lsp-status-dot"
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                STATUS_DOT_CLASSES[status],
              )}
            />
            TS
          </Button>
        </TooltipTrigger>
        <TooltipContent>{tooltipText}</TooltipContent>
      </Tooltip>
      {status === "error" && (
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          data-testid="lsp-retry"
          aria-label="Retry TypeScript language server"
          title="Retry TypeScript language server"
          onClick={() => useLspStore.getState().requestRetry()}
        >
          <RotateCw className="size-3.5" />
        </Button>
      )}
    </div>
  );
}
