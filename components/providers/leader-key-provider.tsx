"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { usePathname } from "next/navigation"
import type { LeaderAction, LeaderBindingsMap } from "@/types/leader-key"
import { DEFAULT_LEADER_BINDINGS } from "@/lib/leader-key-defaults"
import { buildTrie, matchKeys, getNodeAtBuffer } from "@/lib/leader-key-trie"
import type { TrieNode } from "@/lib/leader-key-trie"

const LEADER_TIMEOUT_MS = 2000
const LEAF_WITH_CHILDREN_TIMEOUT_MS = 300

interface LeaderKeyContextValue {
  isLeaderActive: boolean
  keyBuffer: string[]
  activePage: string
  currentNode: TrieNode | null
  bindings: LeaderBindingsMap
  registerAction: (action: LeaderAction, handler: () => void) => void
  deregisterAction: (actionId: string) => void
  cancel: () => void
}

const LeaderKeyContext = createContext<LeaderKeyContextValue | null>(null)

export function useLeaderKey() {
  const context = useContext(LeaderKeyContext)
  if (!context) throw new Error("useLeaderKey must be used within LeaderKeyProvider")
  return context
}

interface LeaderKeyProviderProps {
  children: React.ReactNode
  bindings?: LeaderBindingsMap
}

function pageFromPathname(pathname: string): string {
  if (pathname === "/" || pathname.startsWith("/dashboard")) return "dashboard"
  if (pathname.startsWith("/chat")) return "chat"
  if (pathname.startsWith("/git")) return "git"
  if (pathname.startsWith("/workspaces")) return "repos"
  if (pathname.startsWith("/settings")) return "settings"
  return "unknown"
}

export function LeaderKeyProvider({ children, bindings = DEFAULT_LEADER_BINDINGS }: LeaderKeyProviderProps) {
  const pathname = usePathname()
  const activePage = pageFromPathname(pathname)

  const [isLeaderActive, setIsLeaderActive] = useState(false)
  const [keyBuffer, setKeyBuffer] = useState<string[]>([])
  const [currentNode, setCurrentNode] = useState<TrieNode | null>(null)

  // Registry: actionId -> { action, handler }
  const registryRef = useRef<Map<string, { action: LeaderAction; handler: () => void }>>(new Map())
  // Force a re-render when registry changes so the trie rebuilds
  const [registryVersion, setRegistryVersion] = useState(0)

  const registerAction = useCallback((action: LeaderAction, handler: () => void) => {
    registryRef.current.set(action.id, { action, handler })
    setRegistryVersion((v) => v + 1)
  }, [])

  const deregisterAction = useCallback((actionId: string) => {
    registryRef.current.delete(actionId)
    setRegistryVersion((v) => v + 1)
  }, [])

  // Rebuild trie whenever bindings or registry changes
  const trie = useMemo(() => {
    const registeredIds = new Set(registryRef.current.keys())
    return buildTrie(bindings, registeredIds)
    // registryVersion is the dependency that triggers rebuilds when registry changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bindings, registryVersion])

  // Timeout refs for auto-cancel and leaf-with-children delay
  const leaderTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const leafTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearAllTimers = useCallback(() => {
    if (leaderTimeoutRef.current) {
      clearTimeout(leaderTimeoutRef.current)
      leaderTimeoutRef.current = null
    }
    if (leafTimeoutRef.current) {
      clearTimeout(leafTimeoutRef.current)
      leafTimeoutRef.current = null
    }
  }, [])

  const cancel = useCallback(() => {
    clearAllTimers()
    setIsLeaderActive(false)
    setKeyBuffer([])
    setCurrentNode(null)
  }, [clearAllTimers])

  const fireAction = useCallback((actionId: string) => {
    cancel()
    const entry = registryRef.current.get(actionId)
    entry?.handler()
  }, [cancel])

  // Stable ref so keydown handler always sees latest trie/state without re-subscribing
  const stateRef = useRef({ isLeaderActive, keyBuffer, trie, activePage, cancel, fireAction })
  stateRef.current = { isLeaderActive, keyBuffer, trie, activePage, cancel, fireAction }

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const { isLeaderActive, keyBuffer, trie, activePage, cancel, fireAction } = stateRef.current

      // Activate leader mode: Ctrl+Space
      if (!isLeaderActive) {
        if (e.key === " " && e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey) {
          e.preventDefault()
          setIsLeaderActive(true)
          setKeyBuffer([])
          setCurrentNode(trie)

          // Auto-cancel after LEADER_TIMEOUT_MS of inactivity
          clearAllTimers()
          leaderTimeoutRef.current = setTimeout(() => cancel(), LEADER_TIMEOUT_MS)
        }
        return
      }

      // In leader mode: Escape cancels
      if (e.key === "Escape") {
        e.preventDefault()
        cancel()
        return
      }

      // Ignore modifier-only keys
      if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return

      e.preventDefault()
      e.stopImmediatePropagation()
      clearAllTimers()

      const key = e.shiftKey && e.key.length === 1 ? e.key.toUpperCase() : e.key
      const newBuffer = [...keyBuffer, key]

      const result = matchKeys(trie, newBuffer)

      if (result.kind === "none") {
        cancel()
        return
      }

      setKeyBuffer(newBuffer)

      if (result.kind === "exact") {
        if (!result.hasChildren) {
          // Unambiguous leaf — fire immediately
          fireAction(result.actionId)
          return
        }

        // Leaf that is also a prefix — wait briefly for next key
        const capturedActionId = result.actionId
        const newNode = getNodeAtBuffer(trie, newBuffer)
        setCurrentNode(newNode)
        setIsLeaderActive(true)

        leafTimeoutRef.current = setTimeout(() => {
          fireAction(capturedActionId)
        }, LEAF_WITH_CHILDREN_TIMEOUT_MS)

        // Still arm the overall inactivity timeout
        leaderTimeoutRef.current = setTimeout(() => cancel(), LEADER_TIMEOUT_MS)
        return
      }

      // prefix match — update which-key panel and wait
      const newNode = getNodeAtBuffer(trie, newBuffer)
      setCurrentNode(newNode)
      leaderTimeoutRef.current = setTimeout(() => cancel(), LEADER_TIMEOUT_MS)
    }

    window.addEventListener("keydown", handleKeyDown, { capture: true })
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true })
  }, [clearAllTimers, cancel, fireAction])

  // Cancel leader mode when page changes
  useEffect(() => {
    cancel()
  }, [pathname, cancel])

  const value = useMemo<LeaderKeyContextValue>(
    () => ({
      isLeaderActive,
      keyBuffer,
      activePage,
      currentNode,
      bindings,
      registerAction,
      deregisterAction,
      cancel,
    }),
    [isLeaderActive, keyBuffer, activePage, currentNode, bindings, registerAction, deregisterAction, cancel]
  )

  return (
    <LeaderKeyContext.Provider value={value}>
      {children}
    </LeaderKeyContext.Provider>
  )
}
