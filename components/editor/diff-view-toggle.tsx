"use client"

import { Columns2, Rows3 } from "lucide-react"
import { useEditorStore } from "@/stores/editor-store"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

export function DiffViewToggle() {
  const { diffViewMode, toggleDiffViewMode } = useEditorStore()
  const isSideBySide = diffViewMode === "side-by-side"

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0"
          onClick={toggleDiffViewMode}
        >
          {isSideBySide ? (
            <Columns2 className="size-3.5" />
          ) : (
            <Rows3 className="size-3.5" />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="left">
        <p>{isSideBySide ? "Switch to inline diff" : "Switch to side-by-side diff"}</p>
      </TooltipContent>
    </Tooltip>
  )
}
