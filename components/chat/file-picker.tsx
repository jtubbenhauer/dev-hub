"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { FileIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import type { FileTreeEntry } from "@/types"

function flattenTree(entries: FileTreeEntry[]): string[] {
  const paths: string[] = []
  for (const entry of entries) {
    if (entry.type === "file") {
      paths.push(entry.path)
    } else if (entry.children) {
      paths.push(...flattenTree(entry.children))
    }
  }
  return paths
}

function fuzzyMatch(path: string, query: string): boolean {
  if (!query) return true
  const lower = path.toLowerCase()
  const q = query.toLowerCase()
  let qi = 0
  for (let i = 0; i < lower.length && qi < q.length; i++) {
    if (lower[i] === q[qi]) qi++
  }
  return qi === q.length
}

interface FilePickerProps {
  workspaceId: string
  query: string
  onSelect: (path: string) => void
  onClose: () => void
}

export function FilePicker({ workspaceId, query, onSelect, onClose }: FilePickerProps) {
  const [allPaths, setAllPaths] = useState<string[]>([])
  const [activeIndex, setActiveIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const controller = new AbortController()
    fetch(`/api/files/tree?workspaceId=${workspaceId}&depth=20`, {
      signal: controller.signal,
    })
      .then((res) => res.json())
      .then((data: FileTreeEntry[]) => setAllPaths(flattenTree(data)))
      .catch(() => {})
    return () => controller.abort()
  }, [workspaceId])

  const filtered = allPaths.filter((p) => fuzzyMatch(p, query)).slice(0, 50)

  // Reset active index when query changes
  const [prevQuery, setPrevQuery] = useState(query)
  if (prevQuery !== query) {
    setPrevQuery(query)
    setActiveIndex(0)
  }

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

  // Scroll active item into view
  useEffect(() => {
    const item = listRef.current?.children[activeIndex] as HTMLElement | undefined
    item?.scrollIntoView({ block: "nearest" })
  }, [activeIndex])

  if (filtered.length === 0) {
    return (
      <div className="absolute bottom-full mb-1 w-full max-h-56 overflow-hidden rounded-lg border bg-popover shadow-md">
        <p className="px-3 py-2 text-xs text-muted-foreground">No files found</p>
      </div>
    )
  }

  return (
    <div className="absolute bottom-full mb-1 w-full max-h-56 overflow-y-auto rounded-lg border bg-popover shadow-md">
      <div ref={listRef}>
        {filtered.map((path, index) => {
          const fileName = path.split("/").pop() ?? path
          const dirPath = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ""
          return (
            <button
              key={path}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-accent",
                index === activeIndex && "bg-accent"
              )}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => onSelect(path)}
            >
              <FileIcon className="size-3 shrink-0 text-muted-foreground" />
              <span className="truncate">
                {fileName}
                {dirPath && (
                  <span className="ml-1 text-muted-foreground/60">{dirPath}</span>
                )}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
