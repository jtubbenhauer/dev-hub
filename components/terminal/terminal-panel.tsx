"use client"

import { useEffect, useRef, useCallback, useState } from "react"
import { Terminal as XTerm } from "@xterm/xterm"
import { FitAddon } from "@xterm/addon-fit"
import { WebLinksAddon } from "@xterm/addon-web-links"
import type { ITheme } from "@xterm/xterm"
import "@xterm/xterm/css/xterm.css"

function resolveColor(varName: string): string {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim()
  if (!raw) return ""
  const el = document.createElement("div")
  el.style.color = raw
  document.body.appendChild(el)
  const resolved = getComputedStyle(el).color
  el.remove()
  return resolved
}

function buildTheme(): ITheme {
  const bg = resolveColor("--background")
  const fg = resolveColor("--foreground")
  const accent = resolveColor("--accent")
  const isDark = document.documentElement.classList.contains("dark")

  return {
    background: bg,
    foreground: fg,
    cursor: fg,
    cursorAccent: bg,
    selectionBackground: accent,
    selectionForeground: fg,
    black:         isDark ? "#45475a" : "#bcc0cc",
    red:           isDark ? "#f38ba8" : "#d20f39",
    green:         isDark ? "#a6e3a1" : "#40a02b",
    yellow:        isDark ? "#f9e2af" : "#df8e1d",
    blue:          isDark ? "#89b4fa" : "#1e66f5",
    magenta:       isDark ? "#cba6f7" : "#8839ef",
    cyan:          isDark ? "#94e2d5" : "#179299",
    white:         isDark ? "#bac2de" : "#4c4f69",
    brightBlack:   isDark ? "#585b70" : "#acb0be",
    brightRed:     isDark ? "#f38ba8" : "#d20f39",
    brightGreen:   isDark ? "#a6e3a1" : "#40a02b",
    brightYellow:  isDark ? "#f9e2af" : "#df8e1d",
    brightBlue:    isDark ? "#89b4fa" : "#1e66f5",
    brightMagenta: isDark ? "#cba6f7" : "#8839ef",
    brightCyan:    isDark ? "#94e2d5" : "#179299",
    brightWhite:   isDark ? "#a6adc8" : "#5c5f77",
  }
}

interface TerminalPanelProps {
  wsUrl: string
  workspaceId: string
  cwd: string
  shellCommand: string | null
  scrollback?: number
}

const DEFAULT_SCROLLBACK = 5000

export function TerminalPanel({ wsUrl, workspaceId, cwd, shellCommand, scrollback = DEFAULT_SCROLLBACK }: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<XTerm | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const [connectionState, setConnectionState] = useState<"connecting" | "connected" | "disconnected" | "error">("connecting")

  const connect = useCallback(() => {
    if (!containerRef.current) return

    const term = new XTerm({
      cursorBlink: true,
      fontFamily: "var(--font-geist-mono), monospace",
      fontSize: 14,
      lineHeight: 1.2,
      scrollback,
      theme: buildTheme(),
    })

    const fitAddon = new FitAddon()
    const webLinksAddon = new WebLinksAddon()
    term.loadAddon(fitAddon)
    term.loadAddon(webLinksAddon)
    term.open(containerRef.current)

    try { fitAddon.fit() } catch { void 0 }

    termRef.current = term
    fitAddonRef.current = fitAddon

    const cols = term.cols
    const rows = term.rows
    const params = new URLSearchParams({
      workspaceId,
      cols: String(cols),
      rows: String(rows),
      cwd,
      scrollback: String(scrollback),
    })
    if (shellCommand) params.set("shellCommand", shellCommand)

    const ws = new WebSocket(`${wsUrl}?${params.toString()}`)
    wsRef.current = ws

    ws.onopen = () => {
      setConnectionState("connected")
      term.focus()
    }

    ws.onmessage = (event) => {
      const data = typeof event.data === "string" ? event.data : ""
      if (data.startsWith("{")) {
        try {
          const msg = JSON.parse(data) as { type: string; exitCode?: number; data?: string }
          if (msg.type === "exit") {
            term.writeln(`\r\n[Process exited with code ${msg.exitCode ?? "unknown"}]`)
            setConnectionState("disconnected")
            return
          }
          if (msg.type === "error") {
            term.writeln(`\r\n[Error: ${msg.data}]`)
            setConnectionState("error")
            return
          }
        } catch { void 0 }
      }
      term.write(data)
    }

    ws.onclose = () => {
      setConnectionState("disconnected")
    }

    ws.onerror = () => {
      setConnectionState("error")
    }

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data)
      }
    })

    term.onResize(({ cols, rows }) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols, rows }))
      }
    })
  }, [wsUrl, workspaceId, cwd, shellCommand, scrollback])

  useEffect(() => {
    connect()

    const handleResize = () => {
      try { fitAddonRef.current?.fit() } catch { void 0 }
    }

    window.addEventListener("resize", handleResize)

    const resizeObserver = new ResizeObserver(() => {
      handleResize()
    })
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current)
    }

    return () => {
      window.removeEventListener("resize", handleResize)
      resizeObserver.disconnect()
      wsRef.current?.close()
      termRef.current?.dispose()
      wsRef.current = null
      termRef.current = null
      fitAddonRef.current = null
    }
  }, [connect])

  const handleReconnect = useCallback(() => {
    wsRef.current?.close()
    termRef.current?.dispose()
    wsRef.current = null
    termRef.current = null
    fitAddonRef.current = null
    setConnectionState("connecting")
    connect()
  }, [connect])

  return (
    <div className="flex h-full flex-col">
      {connectionState !== "connected" && (
        <div className="flex items-center gap-2 px-3 py-1.5 text-xs border-b bg-muted/50">
          {connectionState === "connecting" && (
            <span className="text-muted-foreground">Connecting...</span>
          )}
          {connectionState === "disconnected" && (
            <>
              <span className="text-muted-foreground">Disconnected</span>
              <button
                type="button"
                onClick={handleReconnect}
                className="text-primary hover:underline"
              >
                Reconnect
              </button>
            </>
          )}
          {connectionState === "error" && (
            <>
              <span className="text-destructive">Connection error</span>
              <button
                type="button"
                onClick={handleReconnect}
                className="text-primary hover:underline"
              >
                Retry
              </button>
            </>
          )}
        </div>
      )}
      <div ref={containerRef} className="flex-1 min-h-0 p-1" />
    </div>
  )
}
