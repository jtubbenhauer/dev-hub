"use client";

import { TerminalSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTerminalStore } from "@/stores/terminal-store";

export function TerminalToggleButton() {
  const toggle = useTerminalStore((s) => s.toggle);
  const hasUnseenActivity = useTerminalStore(
    (s) => Object.keys(s.unseenActivityKeys).length > 0,
  );

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      title="Terminal (Ctrl+`)"
      aria-label={hasUnseenActivity ? "Terminal (new output)" : "Terminal"}
      className="relative"
    >
      <TerminalSquare className="h-4 w-4" />
      {hasUnseenActivity && (
        <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-blue-500" />
      )}
    </Button>
  );
}
