"use client"

import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"

interface DiffViewerProps {
  diff: string
  fileName?: string
  isLoading?: boolean
}

export function DiffViewer({ diff, fileName, isLoading }: DiffViewerProps) {
  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading diff...
      </div>
    )
  }

  if (!diff) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {fileName ? "No changes" : "Select a file to view diff"}
      </div>
    )
  }

  const lines = parseDiffLines(diff)

  return (
    <ScrollArea className="min-h-0 flex-1">
      {fileName && (
        <div className="sticky top-0 z-10 border-b bg-muted/50 px-3 py-1.5 text-xs font-mono text-muted-foreground">
          {fileName}
        </div>
      )}
      <div className="font-mono text-xs leading-5">
        {lines.map((line, index) => (
          <div
            key={index}
            className={cn(
              "flex",
              line.type === "addition" && "bg-green-500/10",
              line.type === "deletion" && "bg-red-500/10",
              line.type === "hunk" && "bg-blue-500/10 text-blue-400"
            )}
          >
            <span className="w-12 shrink-0 select-none border-r border-border/50 px-1.5 text-right text-muted-foreground/50">
              {line.oldLineNumber ?? ""}
            </span>
            <span className="w-12 shrink-0 select-none border-r border-border/50 px-1.5 text-right text-muted-foreground/50">
              {line.newLineNumber ?? ""}
            </span>
            <span
              className={cn(
                "w-5 shrink-0 select-none text-center",
                line.type === "addition" && "text-green-500",
                line.type === "deletion" && "text-red-500",
                line.type === "hunk" && "text-blue-400"
              )}
            >
              {line.prefix}
            </span>
            <span className="flex-1 whitespace-pre-wrap break-all px-1">
              {line.content}
            </span>
          </div>
        ))}
      </div>
    </ScrollArea>
  )
}

type DiffLineType = "context" | "addition" | "deletion" | "hunk" | "header"

interface DiffLine {
  type: DiffLineType
  content: string
  prefix: string
  oldLineNumber: number | null
  newLineNumber: number | null
}

function parseDiffLines(diff: string): DiffLine[] {
  const rawLines = diff.split("\n")
  const result: DiffLine[] = []
  let oldLine = 0
  let newLine = 0

  for (const raw of rawLines) {
    if (raw.startsWith("@@")) {
      const match = raw.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
      if (match) {
        oldLine = parseInt(match[1], 10)
        newLine = parseInt(match[2], 10)
      }
      result.push({
        type: "hunk",
        content: raw,
        prefix: "@@",
        oldLineNumber: null,
        newLineNumber: null,
      })
    } else if (raw.startsWith("diff ") || raw.startsWith("index ") || raw.startsWith("---") || raw.startsWith("+++")) {
      result.push({
        type: "header",
        content: raw,
        prefix: "",
        oldLineNumber: null,
        newLineNumber: null,
      })
    } else if (raw.startsWith("+")) {
      result.push({
        type: "addition",
        content: raw.slice(1),
        prefix: "+",
        oldLineNumber: null,
        newLineNumber: newLine,
      })
      newLine++
    } else if (raw.startsWith("-")) {
      result.push({
        type: "deletion",
        content: raw.slice(1),
        prefix: "-",
        oldLineNumber: oldLine,
        newLineNumber: null,
      })
      oldLine++
    } else if (raw.startsWith(" ")) {
      result.push({
        type: "context",
        content: raw.slice(1),
        prefix: " ",
        oldLineNumber: oldLine,
        newLineNumber: newLine,
      })
      oldLine++
      newLine++
    } else if (raw === "\\ No newline at end of file") {
      result.push({
        type: "context",
        content: raw,
        prefix: "",
        oldLineNumber: null,
        newLineNumber: null,
      })
    }
  }

  return result
}
