"use client"

import { useEffect, useRef, useCallback, useState } from "react"
import type { ClientMessage, ServerMessage } from "@/lib/commands/types"

interface UseCommandWebSocketOptions {
  onMessage: (message: ServerMessage) => void
  workspaceId?: string
}

const MAX_RECONNECT_DELAY = 10_000
const INITIAL_RECONNECT_DELAY = 500

export function useCommandWebSocket({ onMessage, workspaceId }: UseCommandWebSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null)
  const onMessageRef = useRef(onMessage)
  onMessageRef.current = onMessage
  const [isConnected, setIsConnected] = useState(false)

  useEffect(() => {
    let reconnectDelay = INITIAL_RECONNECT_DELAY
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let disposed = false

    function connect() {
      if (disposed) return

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
      const query = workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : ""
      const url = `${protocol}//${window.location.host}/ws${query}`

      const ws = new WebSocket(url)
      wsRef.current = ws

      ws.onopen = () => {
        setIsConnected(true)
        reconnectDelay = INITIAL_RECONNECT_DELAY
      }

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data as string) as ServerMessage
          onMessageRef.current(message)
        } catch {
          // Ignore malformed messages
        }
      }

      ws.onerror = () => {
        // onerror is always followed by onclose, reconnect logic is there
      }

      ws.onclose = () => {
        setIsConnected(false)
        wsRef.current = null

        if (!disposed) {
          reconnectTimer = setTimeout(() => {
            reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY)
            connect()
          }, reconnectDelay)
        }
      }
    }

    connect()

    return () => {
      disposed = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      wsRef.current?.close()
      wsRef.current = null
    }
  }, [workspaceId])

  const send = useCallback((message: ClientMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message))
    }
  }, [])

  const runCommand = useCallback(
    (sessionId: string, command: string, cols?: number, rows?: number) => {
      send({ type: "run", sessionId, command, workspaceId: workspaceId ?? "", cols, rows })
    },
    [send, workspaceId]
  )

  const killCommand = useCallback(
    (sessionId: string) => {
      send({ type: "kill", sessionId })
    },
    [send]
  )

  const resizeTerminal = useCallback(
    (sessionId: string, cols: number, rows: number) => {
      send({ type: "resize", sessionId, cols, rows })
    },
    [send]
  )

  return { runCommand, killCommand, resizeTerminal, isConnected }
}
