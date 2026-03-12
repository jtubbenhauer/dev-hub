"use client"

import { useState, useEffect, useRef, useCallback, useMemo } from "react"
import { Terminal } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Command } from "@/lib/opencode/types"

export interface SlashCommand {
  name: string
  description?: string
  source: "builtin" | "server"
}

interface CommandPickerProps {
  commands: Command[]
  query: string
  onSelect: (command: SlashCommand) => void
  onClose: () => void
}

const BUILTIN_COMMANDS: SlashCommand[] = [
  { name: "compact", description: "Summarize conversation to save context", source: "builtin" },
  { name: "undo", description: "Revert last assistant message changes", source: "builtin" },
]

function fuzzyMatch(value: string, query: string): boolean {
  if (!query) return true
  const lower = value.toLowerCase()
  const q = query.toLowerCase()
  let qi = 0
  for (let i = 0; i < lower.length && qi < q.length; i++) {
    if (lower[i] === q[qi]) qi++
  }
  return qi === q.length
}

export function CommandPicker({ commands, query, onSelect, onClose }: CommandPickerProps) {
  const [activeIndex, setActiveIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const allCommands = useMemo<SlashCommand[]>(
    () => [
      ...BUILTIN_COMMANDS,
      ...commands.map((command) => ({
        name: command.name,
        description: command.description,
        source: "server" as const,
      })),
    ],
    [commands]
  )

  const filtered = useMemo(
    () => allCommands.filter((cmd) => fuzzyMatch(cmd.name, query)).slice(0, 50),
    [allCommands, query]
  )

  useEffect(() => {
    setActiveIndex(0)
  }, [query])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault()
          setActiveIndex((prev) => Math.min(prev + 1, filtered.length - 1))
          break
        case "ArrowUp":
          e.preventDefault()
          setActiveIndex((prev) => Math.max(prev - 1, 0))
          break
        case "Enter":
          e.preventDefault()
          if (filtered[activeIndex]) onSelect(filtered[activeIndex])
          break
        case "Escape":
          e.preventDefault()
          onClose()
          break
      }
    },
    [filtered, activeIndex, onSelect, onClose]
  )

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [handleKeyDown])

  useEffect(() => {
    const item = listRef.current?.children[activeIndex] as HTMLElement | undefined
    item?.scrollIntoView({ block: "nearest" })
  }, [activeIndex])

  if (filtered.length === 0) {
    return (
      <div className="absolute bottom-full mb-1 w-full max-h-56 overflow-hidden rounded-lg border bg-popover shadow-md">
        <p className="px-3 py-2 text-xs text-muted-foreground">No commands found</p>
      </div>
    )
  }

  return (
    <div className="absolute bottom-full mb-1 w-full max-h-56 overflow-y-auto rounded-lg border bg-popover shadow-md">
      <div ref={listRef}>
        {filtered.map((cmd, index) => (
          <button
            key={`${cmd.source}-${cmd.name}`}
            className={cn(
              "flex w-full items-start gap-2 px-3 py-1.5 text-xs text-left hover:bg-accent",
              index === activeIndex && "bg-accent"
            )}
            onMouseEnter={() => setActiveIndex(index)}
            onClick={() => onSelect(cmd)}
          >
            <Terminal className="size-3 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">
              /{cmd.name}
              {cmd.description && (
                <span className="ml-2 text-muted-foreground/60">{cmd.description}</span>
              )}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
