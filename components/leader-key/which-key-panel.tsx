"use client";

import { useLeaderKey } from "@/components/providers/leader-key-provider";
import { getChildEntries } from "@/lib/leader-key-trie";
import { BUILTIN_ACTIONS } from "@/lib/leader-key-defaults";
import { cn } from "@/lib/utils";

export function WhichKeyPanel() {
  const { isLeaderActive, keyBuffer, currentNode, repeatNode } = useLeaderKey();

  // Between leader sequences, an open repeat window keeps its keys listed.
  const node = isLeaderActive ? currentNode : repeatNode;
  if (!node) return null;

  const isRepeatWindow = !isLeaderActive;
  const childEntries = getChildEntries(node);
  const bufferDisplay = keyBuffer.length > 0 ? keyBuffer.join(" ") : "";

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-8 z-50 flex justify-center">
      <div className="bg-popover/95 pointer-events-auto w-full max-w-sm rounded-lg border p-3 shadow-lg backdrop-blur-sm">
        {/* Header */}
        <div className="mb-2 flex items-center justify-between">
          <span className="text-muted-foreground text-xs font-medium">
            {isRepeatWindow
              ? "Repeat"
              : `Leader${bufferDisplay ? `: ${bufferDisplay}` : ""}`}
          </span>
          <span className="text-muted-foreground text-[10px]">
            {isRepeatWindow ? "Any other key to exit" : "ESC to cancel"}
          </span>
        </div>

        {/* Available next keys */}
        {childEntries.length > 0 && (
          <div className="space-y-0.5">
            {childEntries.map(({ key, actionId, hasChildren }) => {
              const action = actionId
                ? BUILTIN_ACTIONS.find((a) => a.id === actionId)
                : null;
              const label =
                action?.label ?? (hasChildren ? "…" : (actionId ?? ""));
              return (
                <div
                  key={key}
                  className="flex items-center gap-3 rounded px-1 py-0.5"
                >
                  <kbd
                    className={cn(
                      "inline-flex min-w-[1.5rem] items-center justify-center rounded border px-1.5 py-0.5 font-mono text-xs",
                      "border-border bg-muted text-foreground",
                    )}
                  >
                    {key}
                  </kbd>
                  <span className="text-foreground text-xs">{label}</span>
                  {hasChildren && (
                    <span className="text-muted-foreground ml-auto text-[10px]">
                      …
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Show ↵ hint when current buffer position has an action (leaf+prefix ambiguity) */}
        {node.actionId && (
          <div
            className={cn(
              "flex items-center gap-3 rounded px-1 py-0.5",
              childEntries.length > 0 && "mt-1 border-t pt-1",
            )}
          >
            <kbd className="border-border bg-muted text-foreground inline-flex min-w-[1.5rem] items-center justify-center rounded border px-1.5 py-0.5 font-mono text-xs">
              ↵
            </kbd>
            <span className="text-muted-foreground text-xs">
              {BUILTIN_ACTIONS.find((a) => a.id === node.actionId)?.label ??
                node.actionId}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
