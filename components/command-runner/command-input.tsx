"use client"

import { useState, useEffect, useRef, useCallback, KeyboardEvent } from "react"
import { useQuery } from "@tanstack/react-query"
import { Play, Square, ChevronUp, ChevronDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import type { AutocompleteSuggestion } from "@/lib/commands/types"

interface CommandInputProps {
  workspaceId: string | null
  isRunning: boolean
  onRun: (command: string) => void
  onKill: () => void
  className?: string
}

async function fetchSuggestions(workspaceId: string, query: string): Promise<AutocompleteSuggestion[]> {
  if (!query.trim()) return []
  const params = new URLSearchParams({ workspaceId, q: query })
  const res = await fetch(`/api/commands/autocomplete?${params}`)
  if (!res.ok) return []
  const data = await res.json() as { suggestions: AutocompleteSuggestion[] }
  return data.suggestions
}

const SOURCE_BADGE: Record<AutocompleteSuggestion["source"], string> = {
  history: "bg-blue-500/10 text-blue-500",
  alias: "bg-purple-500/10 text-purple-500",
  script: "bg-green-500/10 text-green-500",
  make: "bg-orange-500/10 text-orange-500",
  cargo: "bg-red-500/10 text-red-500",
  workspace: "bg-zinc-500/10 text-zinc-500",
}

export function CommandInput({
  workspaceId,
  isRunning,
  onRun,
  onKill,
  className,
}: CommandInputProps) {
  const [value, setValue] = useState("")
  const [debouncedQuery, setDebouncedQuery] = useState("")
  const [isOpen, setIsOpen] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)

  // Debounce the autocomplete query
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(value), 200)
    return () => clearTimeout(timer)
  }, [value])

  const { data: suggestions = [] } = useQuery({
    queryKey: ["command-autocomplete", workspaceId, debouncedQuery],
    queryFn: () => fetchSuggestions(workspaceId!, debouncedQuery),
    enabled: !!workspaceId && debouncedQuery.length > 0,
    staleTime: 30_000,
  })

  useEffect(() => {
    setIsOpen(suggestions.length > 0 && value.length > 0)
    setSelectedIndex(-1)
  }, [suggestions, value])

  const handleSelect = useCallback((suggestion: AutocompleteSuggestion) => {
    setValue(suggestion.value)
    setIsOpen(false)
    inputRef.current?.focus()
  }, [])

  const handleSubmit = useCallback(() => {
    const command = value.trim()
    if (!command || isRunning) return
    setIsOpen(false)
    setValue("")
    onRun(command)
  }, [value, isRunning, onRun])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        if (isOpen && selectedIndex >= 0 && suggestions[selectedIndex]) {
          handleSelect(suggestions[selectedIndex])
        } else {
          handleSubmit()
        }
        return
      }

      if (e.key === "ArrowDown") {
        e.preventDefault()
        setSelectedIndex((i) => Math.min(i + 1, suggestions.length - 1))
        return
      }

      if (e.key === "ArrowUp") {
        e.preventDefault()
        setSelectedIndex((i) => Math.max(i - 1, -1))
        return
      }

      if (e.key === "Escape") {
        setIsOpen(false)
        return
      }

      if (e.key === "Tab" && suggestions[0]) {
        e.preventDefault()
        handleSelect(suggestions[0])
      }
    },
    [isOpen, selectedIndex, suggestions, handleSelect, handleSubmit]
  )

  return (
    <div className={cn("relative", className)}>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => setIsOpen(suggestions.length > 0 && value.length > 0)}
            onBlur={() => setTimeout(() => setIsOpen(false), 150)}
            placeholder="Enter command…"
            className="font-mono text-sm"
            disabled={isRunning}
            autoComplete="off"
            spellCheck={false}
          />

          {isOpen && (
            <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-64 overflow-auto rounded-md border bg-popover shadow-lg">
              {suggestions.map((s, i) => (
                <button
                  key={`${s.source}-${s.value}`}
                  onMouseDown={() => handleSelect(s)}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent",
                    i === selectedIndex && "bg-accent"
                  )}
                >
                  <span
                    className={cn(
                      "shrink-0 rounded px-1 py-0.5 text-[10px] font-medium uppercase",
                      SOURCE_BADGE[s.source]
                    )}
                  >
                    {s.source}
                  </span>
                  <span className="flex-1 truncate font-mono">{s.label}</span>
                  {i === 0 && (
                    <span className="flex shrink-0 items-center gap-0.5 text-[10px] text-muted-foreground">
                      <ChevronUp className="size-2.5" />
                      <ChevronDown className="size-2.5" />
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {isRunning ? (
          <Button size="sm" variant="destructive" onClick={onKill} className="gap-1.5">
            <Square className="size-3.5" />
            Kill
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={!value.trim()}
            className="gap-1.5"
          >
            <Play className="size-3.5" />
            Run
          </Button>
        )}
      </div>
    </div>
  )
}
