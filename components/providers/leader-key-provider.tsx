"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePathname } from "next/navigation";
import type {
  LeaderAction,
  LeaderBindingsMap,
  ActivationKeyConfig,
} from "@/types/leader-key";
import { DEFAULT_LEADER_BINDINGS } from "@/lib/leader-key-defaults";
import {
  matchesActivationKey,
  DEFAULT_ACTIVATION_KEY,
} from "@/lib/leader-key-utils";
import {
  buildTrie,
  buildRepeatNode,
  matchKeys,
  getNodeAtBuffer,
} from "@/lib/leader-key-trie";
import type { TrieNode } from "@/lib/leader-key-trie";

const DEFAULT_LEADER_TIMEOUT_MS = 2000;
const LEAF_WITH_CHILDREN_TIMEOUT_MS = 300;
const REPEAT_WINDOW_MS = 1000;
const MODIFIER_KEYS = ["Control", "Shift", "Alt", "Meta"];

interface LeaderKeyContextValue {
  isLeaderActive: boolean;
  keyBuffer: string[];
  activePage: string;
  currentNode: TrieNode | null;
  // Keys that fire without the leader until the repeat window closes.
  repeatNode: TrieNode | null;
  bindings: LeaderBindingsMap;
  registerAction: (action: LeaderAction, handler: () => void) => void;
  deregisterAction: (actionId: string) => void;
  cancel: () => void;
}

const LeaderKeyContext = createContext<LeaderKeyContextValue | null>(null);

export function useLeaderKey() {
  const context = useContext(LeaderKeyContext);
  if (!context)
    throw new Error("useLeaderKey must be used within LeaderKeyProvider");
  return context;
}

interface LeaderKeyProviderProps {
  children: React.ReactNode;
  bindings?: LeaderBindingsMap;
  timeoutMs?: number | null;
  activationKey?: ActivationKeyConfig;
}

function pageFromPathname(pathname: string): string {
  if (pathname === "/" || pathname.startsWith("/dashboard")) return "dashboard";
  if (pathname.startsWith("/chat")) return "chat";
  if (pathname.startsWith("/git")) return "git";
  if (pathname.startsWith("/workspaces")) return "repos";
  if (pathname.startsWith("/settings")) return "settings";
  if (pathname.startsWith("/files")) return "files";
  if (pathname.startsWith("/tasks")) return "tasks";
  return "unknown";
}

function getPressedKey(e: KeyboardEvent): string {
  return e.shiftKey && e.key.length === 1 ? e.key.toUpperCase() : e.key;
}

export function LeaderKeyProvider({
  children,
  bindings = DEFAULT_LEADER_BINDINGS,
  timeoutMs = DEFAULT_LEADER_TIMEOUT_MS,
  activationKey = DEFAULT_ACTIVATION_KEY,
}: LeaderKeyProviderProps) {
  const pathname = usePathname();
  const activePage = pageFromPathname(pathname);

  const [isLeaderActive, setIsLeaderActive] = useState(false);
  const [keyBuffer, setKeyBuffer] = useState<string[]>([]);
  const [currentNode, setCurrentNode] = useState<TrieNode | null>(null);
  const [repeatNode, setRepeatNode] = useState<TrieNode | null>(null);

  // Registry: actionId -> { action, handler }
  const registryRef = useRef<
    Map<string, { action: LeaderAction; handler: () => void }>
  >(new Map());
  // Force a re-render when registry changes so the trie rebuilds
  const [registryVersion, setRegistryVersion] = useState(0);

  const registerAction = useCallback(
    (action: LeaderAction, handler: () => void) => {
      registryRef.current.set(action.id, { action, handler });
      setRegistryVersion((v) => v + 1);
    },
    [],
  );

  const deregisterAction = useCallback((actionId: string) => {
    registryRef.current.delete(actionId);
    setRegistryVersion((v) => v + 1);
  }, []);

  // Rebuild trie whenever bindings or registry changes
  const trie = useMemo(() => {
    const registeredIds = new Set(registryRef.current.keys());
    return buildTrie(bindings, registeredIds);
    // registryVersion is the dependency that triggers rebuilds when registry changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bindings, registryVersion]);

  // Timeout refs for auto-cancel, leaf-with-children delay and the repeat window
  const leaderTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leafTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const repeatTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearAllTimers = useCallback(() => {
    if (leaderTimeoutRef.current) {
      clearTimeout(leaderTimeoutRef.current);
      leaderTimeoutRef.current = null;
    }
    if (leafTimeoutRef.current) {
      clearTimeout(leafTimeoutRef.current);
      leafTimeoutRef.current = null;
    }
    if (repeatTimeoutRef.current) {
      clearTimeout(repeatTimeoutRef.current);
      repeatTimeoutRef.current = null;
    }
  }, []);

  const cancel = useCallback(() => {
    clearAllTimers();
    setIsLeaderActive(false);
    setKeyBuffer([]);
    setCurrentNode(null);
    setRepeatNode(null);
  }, [clearAllTimers]);

  const fireAction = useCallback(
    (actionId: string) => {
      cancel();
      const entry = registryRef.current.get(actionId);
      entry?.handler();
    },
    [cancel],
  );

  const armLeaderTimeout = useCallback(() => {
    if (timeoutMs !== null) {
      leaderTimeoutRef.current = setTimeout(() => cancel(), timeoutMs);
    }
  }, [timeoutMs, cancel]);

  const isRepeatableAction = useCallback(
    (actionId: string) =>
      registryRef.current.get(actionId)?.action.isRepeatable === true,
    [],
  );

  // Opens the repeat window, or restarts it while it is open.
  const openRepeatWindow = useCallback(
    (node: TrieNode | null) => {
      if (!node) return;
      if (repeatTimeoutRef.current) clearTimeout(repeatTimeoutRef.current);
      setRepeatNode(node);
      repeatTimeoutRef.current = setTimeout(() => cancel(), REPEAT_WINDOW_MS);
    },
    [cancel],
  );

  // Stable ref so keydown handler always sees latest trie/state without re-subscribing
  const stateRef = useRef({
    isLeaderActive,
    keyBuffer,
    trie,
    repeatNode,
    activePage,
    cancel,
    armLeaderTimeout,
    activationKey,
  });
  stateRef.current = {
    isLeaderActive,
    keyBuffer,
    trie,
    repeatNode,
    activePage,
    cancel,
    armLeaderTimeout,
    activationKey,
  };

  useEffect(() => {
    // Fires a leader action, then keeps it one key away if it is repeatable.
    function fireLeaderAction(
      trie: TrieNode,
      actionId: string,
      firedKeys: string[],
    ) {
      fireAction(actionId);
      openRepeatWindow(buildRepeatNode(trie, firedKeys, isRepeatableAction));
    }

    function handleRepeatKey(e: KeyboardEvent, node: TrieNode) {
      if (MODIFIER_KEYS.includes(e.key)) return;
      const hasCommandModifier = e.ctrlKey || e.metaKey || e.altKey;
      const actionId = hasCommandModifier
        ? undefined
        : node.children.get(getPressedKey(e))?.actionId;
      const entry =
        actionId === undefined ? undefined : registryRef.current.get(actionId);
      // Any other key closes the window and reaches the page untouched.
      if (!entry) {
        cancel();
        return;
      }
      e.preventDefault();
      e.stopImmediatePropagation();
      entry.handler();
      openRepeatWindow(node);
    }

    function handleKeyDown(e: KeyboardEvent) {
      const {
        isLeaderActive,
        keyBuffer,
        trie,
        repeatNode,
        cancel,
        armLeaderTimeout,
        activationKey,
      } = stateRef.current;

      // Activate leader mode with configurable activation key
      if (!isLeaderActive) {
        if (matchesActivationKey(e, activationKey)) {
          e.preventDefault();
          setIsLeaderActive(true);
          setKeyBuffer([]);
          setCurrentNode(trie);
          setRepeatNode(null);

          clearAllTimers();
          armLeaderTimeout();
        } else if (repeatNode) {
          handleRepeatKey(e, repeatNode);
        }
        return;
      }

      // In leader mode: Escape cancels
      if (e.key === "Escape") {
        e.preventDefault();
        cancel();
        return;
      }

      // Ignore modifier-only keys
      if (MODIFIER_KEYS.includes(e.key)) return;

      e.preventDefault();
      e.stopImmediatePropagation();
      clearAllTimers();

      const newBuffer = [...keyBuffer, getPressedKey(e)];

      const result = matchKeys(trie, newBuffer);

      if (result.kind === "none") {
        cancel();
        return;
      }

      setKeyBuffer(newBuffer);

      if (result.kind === "exact") {
        if (!result.hasChildren) {
          // Unambiguous leaf — fire immediately
          fireLeaderAction(trie, result.actionId, newBuffer);
          return;
        }

        // Leaf that is also a prefix — wait briefly for next key
        const capturedActionId = result.actionId;
        const newNode = getNodeAtBuffer(trie, newBuffer);
        setCurrentNode(newNode);
        setIsLeaderActive(true);

        leafTimeoutRef.current = setTimeout(() => {
          fireLeaderAction(trie, capturedActionId, newBuffer);
        }, LEAF_WITH_CHILDREN_TIMEOUT_MS);

        armLeaderTimeout();
        return;
      }

      // prefix match — update which-key panel and wait
      const newNode = getNodeAtBuffer(trie, newBuffer);
      setCurrentNode(newNode);
      armLeaderTimeout();
    }

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () =>
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [
    clearAllTimers,
    cancel,
    fireAction,
    openRepeatWindow,
    isRepeatableAction,
  ]);

  // Cancel leader mode when page changes
  useEffect(() => {
    cancel();
  }, [pathname, cancel]);

  const value = useMemo<LeaderKeyContextValue>(
    () => ({
      isLeaderActive,
      keyBuffer,
      activePage,
      currentNode,
      repeatNode,
      bindings,
      registerAction,
      deregisterAction,
      cancel,
    }),
    [
      isLeaderActive,
      keyBuffer,
      activePage,
      currentNode,
      repeatNode,
      bindings,
      registerAction,
      deregisterAction,
      cancel,
    ],
  );

  return (
    <LeaderKeyContext.Provider value={value}>
      {children}
    </LeaderKeyContext.Provider>
  );
}
