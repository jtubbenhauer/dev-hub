"use client"

import { useEditorStore } from "@/stores/editor-store"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

export function VimToggle() {
  const { isVimMode, toggleVimMode } = useEditorStore()

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "h-6 px-2 text-xs font-mono",
            isVimMode && "bg-green-600/20 border-green-600/50 text-green-500"
          )}
          onClick={toggleVimMode}
        >
          VIM
        </Button>
      </TooltipTrigger>
      <TooltipContent side="left">
        <p>{isVimMode ? "Disable" : "Enable"} Vim mode</p>
      </TooltipContent>
    </Tooltip>
  )
}
