"use client";

import { Button } from "@/components/ui/button";
import type { PermissionRequest } from "@/lib/opencode/types";
import { Check, ShieldAlert, X } from "lucide-react";

function formatPermissionTitle(permission: string): string {
  return permission.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function PermissionBanner({
  permission,
  onRespond,
}: {
  permission: PermissionRequest;
  onRespond: (response: string) => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-amber-500/50 bg-amber-500/5 px-3 py-2">
      <ShieldAlert className="size-5 shrink-0 text-amber-600" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">
          {formatPermissionTitle(permission.permission)}
        </p>
        {permission.patterns.length > 0 && (
          <p className="text-muted-foreground truncate text-xs">
            {permission.patterns.join(", ")}
          </p>
        )}
      </div>
      <div className="flex shrink-0 gap-1.5">
        <Button
          size="sm"
          variant="outline"
          onClick={() => onRespond("deny")}
          className="gap-1"
        >
          <X className="size-3" />
          Deny
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => onRespond("allow")}
          className="gap-1"
        >
          <Check className="size-3" />
          Allow
        </Button>
        <Button size="sm" onClick={() => onRespond("always")} className="gap-1">
          <Check className="size-3" />
          Always
        </Button>
      </div>
    </div>
  );
}
