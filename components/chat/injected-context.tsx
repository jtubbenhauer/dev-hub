"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, CircleArrowUp, Layers } from "lucide-react";
import type { InjectedContextBlock } from "@/lib/chat/user-message-parts";

export function InjectedNotice({ notice }: { notice: string }) {
  const [headline, ...details] = notice.split("\n");
  return (
    <div className="flex max-w-full items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
      <CircleArrowUp className="mt-px size-3.5 shrink-0" />
      <div className="min-w-0 space-y-0.5">
        <p className="font-medium break-words">{headline}</p>
        {details.length > 0 && (
          <p className="break-words whitespace-pre-wrap opacity-80">
            {details.join("\n")}
          </p>
        )}
      </div>
    </div>
  );
}

// Collapsed by default and only mounted when opened: blocks can be whole
// file reads, and long chats render many of them.
export function InjectedContextDisclosure({
  blocks,
}: {
  blocks: InjectedContextBlock[];
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  return (
    <div className="flex max-w-full flex-col items-end gap-1.5">
      <button
        type="button"
        aria-expanded={isExpanded}
        onClick={() => setIsExpanded((wasExpanded) => !wasExpanded)}
        title="Text that OpenCode or a plugin added to this message for the model"
        className="text-muted-foreground hover:bg-muted/50 hover:text-foreground flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] transition-colors"
      >
        {isExpanded ? (
          <ChevronDown className="size-3" />
        ) : (
          <ChevronRight className="size-3" />
        )}
        <Layers className="size-3" />
        Injected context
        {blocks.length > 1 && ` (${blocks.length})`}
      </button>
      {isExpanded &&
        blocks.map((block) => (
          <pre
            key={block.id}
            className="bg-muted/20 text-muted-foreground max-h-80 max-w-full overflow-auto rounded-lg border border-dashed px-3 py-2 font-mono text-[11px] leading-relaxed break-words whitespace-pre-wrap"
          >
            {block.text}
          </pre>
        ))}
    </div>
  );
}
