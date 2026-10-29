"use client";

import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  formatAccessTimeRemaining,
  readWorkspaceAccess,
} from "@/lib/workspaces/access-profiles";

const COUNTDOWN_REFRESH_MS = 60_000;

interface WorkspaceAccessBadgeProps {
  providerMeta: Record<string, unknown> | null;
}

export function WorkspaceAccessBadge({
  providerMeta,
}: WorkspaceAccessBadgeProps) {
  const access = readWorkspaceAccess(providerMeta);
  const expiresAt = access?.expiresAt;
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (!expiresAt) return;
    const interval = setInterval(
      () => setNow(new Date()),
      COUNTDOWN_REFRESH_MS,
    );
    return () => clearInterval(interval);
  }, [expiresAt]);

  if (!access) return null;

  const timeRemaining = expiresAt
    ? formatAccessTimeRemaining(expiresAt, now)
    : undefined;
  const isExpired = timeRemaining === "expired";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          className={cn(
            "gap-1 text-xs",
            !expiresAt && "border-emerald-500/50 text-emerald-600",
            expiresAt && !isExpired && "border-amber-500/50 text-amber-600",
            isExpired && "border-red-500/50 text-red-600",
          )}
        >
          <ShieldCheck className="size-3" />
          {access.profile}
          {timeRemaining && (
            <span className="text-muted-foreground">· {timeRemaining}</span>
          )}
        </Badge>
      </TooltipTrigger>
      <TooltipContent>
        <p>Google Cloud access: {access.profile}</p>
        {access.reason && <p>Reason: {access.reason}</p>}
        {isExpired && <p>Access has expired.</p>}
      </TooltipContent>
    </Tooltip>
  );
}
