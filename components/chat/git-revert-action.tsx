"use client";

import { Undo2 } from "lucide-react";

import { cn } from "@/lib/utils";

function isActivateKey(e: React.KeyboardEvent): boolean {
  return e.key === "Enter" || e.key === " ";
}

export function GitRevertAction({
  disabled,
  onActivate,
}: {
  disabled: boolean;
  onActivate: () => void;
}) {
  return (
    <span
      role="button"
      tabIndex={0}
      aria-label="Revert file"
      aria-disabled={disabled}
      title="Revert file"
      data-testid="git-revert-action"
      className={cn(
        "text-muted-foreground hover:text-foreground hidden shrink-0 rounded p-0.5 transition-colors group-hover:block",
        disabled && "opacity-50",
      )}
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) onActivate();
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (isActivateKey(e)) {
          e.preventDefault();
          if (!disabled) onActivate();
        }
      }}
    >
      <Undo2 className="size-3" />
    </span>
  );
}
