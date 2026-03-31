"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  Session,
  Message,
  Part,
  PermissionRequest,
  Todo,
  SessionStatus,
  MessageWithParts,
  QuestionRequest,
  QuestionAnswer,
  Command,
} from "@/lib/opencode/types";
import { playSoundForEvent } from "@/lib/sounds";
import { sendBrowserNotification } from "@/lib/notifications";
import { toast } from "sonner";

export type StreamingStatus =
  | "idle"
  | "connecting"
  | "streaming"
  | "waiting"
  | "error";

const MAX_CACHED_SESSIONS = 15;

interface LruEntry {
  sessionId: string;
  workspaceId: string;
}

interface QueuedMessage {
  sessionId: string;
  text: string;
  workspaceId: string;
  model?: { providerID: string; modelID: string };
  agent?: string;
  variant?: string;
  attachments?: Array<{ mime: string; dataUrl: string; filename: string }>;
  optimisticMessageId: string;
}

export interface SessionWithWorkspace extends Session {
  workspaceId: string;
}

// Activity level for a workspace — used by UI indicators
export type WorkspaceActivity = "idle" | "active" | "waiting";

// Per-workspace state bucket
export interface WorkspaceState {
  sessions: Record<string, Session>;
  sessionsLoaded: boolean;
  messages: Record<string, MessageWithParts[]>;
  optimisticMessageIds: Record<string, string>;
  sessionStatuses: Record<string, SessionStatus>;
  permissions: PermissionRequest[];
  questions: QuestionRequest[];
  todos: Record<string, Todo[]>;
  sessionAgents: Record<string, string>;
  sessionModels: Record<string, { providerID: string; modelID: string }>;
  sessionVariants: Record<string, string>;
  lastViewedAt: Record<string, number>;
  pinnedSessionIds: Set<string>;
  sessionNotes: Record<string, string>;
}

function emptyWorkspaceState(): WorkspaceState {
  return {
    sessions: {},
    sessionsLoaded: false,
    messages: {},
    optimisticMessageIds: {},
    sessionStatuses: {},
    permissions: [],
    questions: [],
    todos: {},
    sessionAgents: {},
    sessionModels: {},
    sessionVariants: {},
    lastViewedAt: {},
    pinnedSessionIds: new Set(),
    sessionNotes: {},
  };
}

// Stable empty references to avoid infinite re-render loops with Zustand selectors.
// Returning `{}` or `[]` inline creates a new reference each call, breaking Object.is equality.
const EMPTY_SESSIONS: Record<string, Session> = {};
const EMPTY_MESSAGES: MessageWithParts[] = [];
const EMPTY_PERMISSIONS: PermissionRequest[] = [];
const EMPTY_QUESTIONS: QuestionRequest[] = [];
const EMPTY_TODOS: Todo[] = [];
const EMPTY_SESSION_STATUSES: Record<string, SessionStatus> = {};
const EMPTY_LAST_VIEWED: Record<string, number> = {};
const EMPTY_UNIFIED_SESSIONS: SessionWithWorkspace[] = [];
const EMPTY_PINNED: Set<string> = new Set();
const EMPTY_SESSION_NOTES: Record<string, string> = {};

// Memoization cache for getRecentSessionsAcrossWorkspaces.
// We compare each workspace's `sessions` record by reference to detect changes.
let _unifiedSessionsCache: SessionWithWorkspace[] = EMPTY_UNIFIED_SESSIONS;
let _unifiedSessionsCacheRefs = new Map<string, Record<string, Session>>();
let _unifiedSessionsCacheLimit = 0;
let _unifiedSessionsCacheTime = 0;

// Memoization cache for getUnifiedSessionStatuses.
let _unifiedStatusesCache: Record<string, SessionStatus> =
  EMPTY_SESSION_STATUSES;
let _unifiedStatusesCacheRefs = new Map<
  string,
  Record<string, SessionStatus>
>();

// Memoization cache for getUnifiedLastViewedAt.
let _unifiedLastViewedCache: Record<string, number> = EMPTY_LAST_VIEWED;
let _unifiedLastViewedCacheRefs = new Map<string, Record<string, number>>();

let _unifiedPinnedCache: Set<string> = EMPTY_PINNED;
let _unifiedPinnedCacheRefs = new Map<string, Set<string>>();

let _unifiedSessionNotesCache: Record<string, string> = EMPTY_SESSION_NOTES;
let _unifiedSessionNotesCacheRefs = new Map<string, Record<string, string>>();

// Memoization caches for question-session-id selectors.
const EMPTY_QUESTION_SESSION_IDS: Set<string> = new Set();
let _activeQuestionSessionIdsCache: Set<string> = EMPTY_QUESTION_SESSION_IDS;
let _activeQuestionSessionIdsCacheRef: QuestionRequest[] = EMPTY_QUESTIONS;
let _unifiedQuestionSessionIdsCache: Set<string> = EMPTY_QUESTION_SESSION_IDS;
let _unifiedQuestionSessionIdsCacheRefs = new Map<string, QuestionRequest[]>();

// RAF-batched buffer for message.part.updated events.
// Keyed: sessionId → messageId → partId → Part
const pendingPartUpdates = new Map<string, Map<string, Map<string, Part>>>();
let partFlushScheduled = false;
let partFlushHandle: number | null = null;

// AbortController for in-flight SSE onopen fetch calls (permissions, questions).
// Aborted when SSE reconnects or disconnects to prevent stale responses.
let sseOnopenAbortController: AbortController | null = null;

// Dedup in-flight fetchSessions calls to prevent duplicate API requests
const _fetchSessionsInFlight = new Set<string>();

// RAF-batched buffer for message.updated events.
// Keyed: sessionId → Message (latest info wins)
interface PendingMessageUpdate {
  info: Message;
  sourceWorkspaceId: string;
}
const pendingMessageUpdates = new Map<
  string,
  Map<string, PendingMessageUpdate>
>();
let messageFlushScheduled = false;
let messageFlushHandle: number | null = null;

// Fallback for routing events for child sessions not yet in ws.sessions
const sessionSourceWorkspace = new Map<string, string>();

// Exported for tests — resets all module-level memoization caches between runs
export function _resetModuleCaches() {
  _unifiedSessionsCache = EMPTY_UNIFIED_SESSIONS;
  _unifiedSessionsCacheRefs = new Map();
  _unifiedSessionsCacheLimit = 0;
  _unifiedSessionsCacheTime = 0;

  _unifiedStatusesCache = EMPTY_SESSION_STATUSES;
  _unifiedStatusesCacheRefs = new Map();

  _unifiedLastViewedCache = EMPTY_LAST_VIEWED;
  _unifiedLastViewedCacheRefs = new Map();

  _unifiedPinnedCache = EMPTY_PINNED;
  _unifiedPinnedCacheRefs = new Map();

  _unifiedSessionNotesCache = EMPTY_SESSION_NOTES;
  _unifiedSessionNotesCacheRefs = new Map();

  _activeQuestionSessionIdsCache = EMPTY_QUESTION_SESSION_IDS;
  _activeQuestionSessionIdsCacheRef = EMPTY_QUESTIONS;
  _unifiedQuestionSessionIdsCache = EMPTY_QUESTION_SESSION_IDS;
  _unifiedQuestionSessionIdsCacheRefs = new Map();

  _fetchSessionsInFlight.clear();
  pendingPartUpdates.clear();
  pendingMessageUpdates.clear();
  sessionSourceWorkspace.clear();
}
const flushingQueuedWorkspaces = new Set<string>();

function flushPendingPartUpdates(
  set: (fn: (state: ChatState) => Partial<ChatState>) => void,
): void {
  if (pendingPartUpdates.size === 0) return;

  const snapshot = new Map(
    [...pendingPartUpdates.entries()].map(([sessionId, byMessage]) => [
      sessionId,
      new Map(
        [...byMessage.entries()].map(([messageId, byPart]) => [
          messageId,
          new Map(byPart),
        ]),
      ),
    ]),
  );
  pendingPartUpdates.clear();

  set((state) => {
    // Find which workspace owns each session and update its messages
    const nextWorkspaceStates = { ...state.workspaceStates };

    for (const [sessionId, byMessage] of snapshot) {
      const wsId =
        findWorkspaceForSession(state.workspaceStates, sessionId) ??
        sessionSourceWorkspace.get(sessionId);
      if (!wsId) continue;

      const ws = nextWorkspaceStates[wsId];
      if (!ws) continue;
      const sessionMessages = ws.messages[sessionId] ?? [];

      let updatedSession = sessionMessages;
      for (const [messageId, byPart] of byMessage) {
        const messageIndex = updatedSession.findIndex(
          (m) => m.info.id === messageId,
        );
        if (messageIndex < 0) continue;

        const message = updatedSession[messageIndex];
        let updatedParts = message.parts;

        for (const [partId, part] of byPart) {
          const partIndex = updatedParts.findIndex((p) => p.id === partId);
          updatedParts =
            partIndex >= 0
              ? updatedParts.map((p, i) => (i === partIndex ? part : p))
              : [...updatedParts, part];
        }

        updatedSession = updatedSession.map((m, i) =>
          i === messageIndex ? { ...m, parts: updatedParts } : m,
        );
      }

      nextWorkspaceStates[wsId] = {
        ...ws,
        messages: { ...ws.messages, [sessionId]: updatedSession },
      };
    }

    return { workspaceStates: nextWorkspaceStates };
  });
}

function schedulePendingPartFlush(
  set: (fn: (state: ChatState) => Partial<ChatState>) => void,
): void {
  if (partFlushScheduled) return;
  partFlushScheduled = true;

  if (typeof document !== "undefined" && document.hidden) {
    partFlushHandle = window.setTimeout(() => {
      partFlushScheduled = false;
      partFlushHandle = null;
      flushPendingPartUpdates(set);
    }, 500) as unknown as number;
  } else {
    partFlushHandle = requestAnimationFrame(() => {
      partFlushScheduled = false;
      partFlushHandle = null;
      flushPendingPartUpdates(set);
    }) as unknown as number;
  }
}

function flushPendingMessageUpdates(
  set: (fn: (state: ChatState) => Partial<ChatState>) => void,
  get: () => ChatState,
): void {
  if (pendingMessageUpdates.size === 0) return;

  const snapshot = new Map(
    [...pendingMessageUpdates.entries()].map(([sessionId, byMessage]) => [
      sessionId,
      new Map(byMessage),
    ]),
  );
  pendingMessageUpdates.clear();

  // Collect finished assistant messages so we can trigger status refresh after set()
  const finishedWorkspaces = new Set<string>();

  set((state) => {
    const nextWorkspaceStates = { ...state.workspaceStates };

    for (const [sessionId, byMessage] of snapshot) {
      for (const [, { info, sourceWorkspaceId }] of byMessage) {
        const wsId =
          findWorkspaceForSession(nextWorkspaceStates, sessionId) ??
          sourceWorkspaceId;
        const ws = nextWorkspaceStates[wsId] ?? emptyWorkspaceState();

        const optimisticId = ws.optimisticMessageIds[sessionId];
        const sessionMessages = (ws.messages[sessionId] ?? []).filter(
          (m) =>
            !(
              info.role === "user" &&
              optimisticId &&
              m.info.id === optimisticId
            ),
        );
        const optimisticMessageIds =
          info.role === "user" && optimisticId
            ? Object.fromEntries(
                Object.entries(ws.optimisticMessageIds).filter(
                  ([k]) => k !== sessionId,
                ),
              )
            : ws.optimisticMessageIds;

        const existingIndex = sessionMessages.findIndex(
          (m) => m.info.id === info.id,
        );
        const updated =
          existingIndex >= 0
            ? sessionMessages.map((m, i) =>
                i === existingIndex ? { ...m, info } : m,
              )
            : [...sessionMessages, { info, parts: [] }];

        nextWorkspaceStates[wsId] = {
          ...ws,
          optimisticMessageIds,
          messages: { ...ws.messages, [sessionId]: updated },
        };

        if (info.role === "assistant" && "finish" in info && info.finish) {
          finishedWorkspaces.add(sourceWorkspaceId);
        }
      }
    }

    return { workspaceStates: nextWorkspaceStates };
  });

  // Apply LRU touches for all sessions that received message updates
  const sessionsToTouch: Array<{ sessionId: string; workspaceId: string }> = [];
  for (const [sessionId, byMessage] of snapshot) {
    for (const [, { sourceWorkspaceId }] of byMessage) {
      sessionsToTouch.push({ sessionId, workspaceId: sourceWorkspaceId });
      break; // one touch per session is sufficient
    }
  }
  if (sessionsToTouch.length > 0) {
    set((state) => {
      let merged: Partial<ChatState> = {};
      let current = state;
      for (const { sessionId, workspaceId } of sessionsToTouch) {
        const lruUpdate = touchLru(current, sessionId, workspaceId);
        merged = { ...merged, ...lruUpdate };
        current = { ...current, ...lruUpdate } as ChatState;
      }
      return merged;
    });
  }

  for (const wsId of finishedWorkspaces) {
    get().refreshActiveSessionStatus(wsId);
  }
}

function schedulePendingMessageFlush(
  set: (fn: (state: ChatState) => Partial<ChatState>) => void,
  get: () => ChatState,
): void {
  if (messageFlushScheduled) return;
  messageFlushScheduled = true;

  if (typeof document !== "undefined" && document.hidden) {
    messageFlushHandle = window.setTimeout(() => {
      messageFlushScheduled = false;
      messageFlushHandle = null;
      flushPendingMessageUpdates(set, get);
    }, 500) as unknown as number;
  } else {
    messageFlushHandle = requestAnimationFrame(() => {
      messageFlushScheduled = false;
      messageFlushHandle = null;
      flushPendingMessageUpdates(set, get);
    }) as unknown as number;
  }
}

function findWorkspaceForSession(
  workspaceStates: Record<string, WorkspaceState>,
  sessionId: string,
): string | null {
  for (const [wsId, ws] of Object.entries(workspaceStates)) {
    if (sessionId in ws.sessions) return wsId;
  }
  return null;
}

// Snapshot of a session's data for undo restoration
export interface SessionSnapshot {
  sessionId: string;
  workspaceId: string;
  session: Session;
  messages: MessageWithParts[];
  optimisticMessageId: string | undefined;
  sessionStatus: SessionStatus | undefined;
  todos: Todo[] | undefined;
  sessionAgent: string | undefined;
  sessionModel: { providerID: string; modelID: string } | undefined;
  sessionVariant: string | undefined;
  lastViewedAt: number | undefined;
  wasActive: boolean;
}

interface ChatState {
  workspaceStates: Record<string, WorkspaceState>;
  commands: Command[];
  messageAccessOrder: LruEntry[];
  queuedMessages: Map<string, QueuedMessage[]>;
  queuedWorkspaceIds: Set<string>;

  // UI focus
  activeWorkspaceId: string | null;
  activeSessionId: string | null;

  // Streaming error for the focused session — stored explicitly because it has no other source of truth
  streamingError: string | null;
  streamingPollInterval: ReturnType<typeof setInterval> | null;
  // Set to a sessionId when sendMessage fires — gives instant "streaming" feedback before the first SSE arrives
  optimisticStreamingSessionId: string | null;

  // Workspace/session setters
  setActiveSession: (sessionId: string | null) => void;
  setActiveWorkspaceId: (workspaceId: string | null) => void;

  // Session CRUD
  fetchSessions: (workspaceId: string) => Promise<void>;
  createSession: (workspaceId: string) => Promise<Session | null>;
  deleteSession: (sessionId: string, workspaceId: string) => Promise<void>;
  removeSessionLocal: (
    sessionId: string,
    workspaceId: string,
  ) => SessionSnapshot | null;
  restoreSessionLocal: (snapshot: SessionSnapshot) => void;
  fetchMessages: (sessionId: string, workspaceId: string) => Promise<void>;
  fetchCommands: (workspaceId: string) => Promise<void>;
  summarizeSession: (
    sessionId: string,
    workspaceId: string,
    model?: { providerID: string; modelID: string },
  ) => Promise<void>;
  revertSession: (
    sessionId: string,
    workspaceId: string,
    messageID: string,
  ) => Promise<string | null>;

  // Messaging
  sendMessage: (
    sessionId: string,
    text: string,
    workspaceId: string,
    model?: { providerID: string; modelID: string },
    agent?: string,
    variant?: string,
    attachments?: Array<{ mime: string; dataUrl: string; filename: string }>,
  ) => Promise<void>;
  flushQueuedMessages: (workspaceId: string) => Promise<void>;
  hasQueuedMessages: (workspaceId: string) => boolean;
  executeCommand: (
    sessionId: string,
    workspaceId: string,
    command: string,
    args: string,
    model?: { providerID: string; modelID: string },
    agent?: string,
    variant?: string,
  ) => Promise<void>;
  abortSession: (sessionId: string, workspaceId: string) => Promise<void>;
  respondToPermission: (
    sessionId: string,
    permissionId: string,
    response: string,
    workspaceId: string,
  ) => Promise<void>;
  replyToQuestion: (
    requestId: string,
    answers: QuestionAnswer[],
    workspaceId: string,
  ) => Promise<void>;
  rejectQuestion: (requestId: string, workspaceId: string) => Promise<void>;

  globalEventSource: EventSource | null;
  sseReconnectAttempts: number;
  sseReconnectTimer: ReturnType<typeof setTimeout> | null;
  sseWorkspaceIds: string[];
  connectGlobalSSE: (workspaceIds: string[]) => void;
  disconnectGlobalSSE: () => void;
  refreshActiveSessionStatus: (workspaceId: string) => Promise<void>;
  handleVisibilityRestored: () => void;

  // Internal
  handleEvent: (
    event: Record<string, unknown>,
    sourceWorkspaceId: string,
  ) => void;
  clearChat: () => void;
  startStreamingPoll: (workspaceId: string) => void;
  clearStreamingPoll: () => void;

  // Selectors used by UI
  getStreamingStatus: () => StreamingStatus;
  getWorkspaceActivity: (workspaceId: string) => WorkspaceActivity;
  getActiveWorkspaceSessions: () => Record<string, Session>;
  getActiveSessionMessages: () => MessageWithParts[];
  getActiveSessionStatus: () => SessionStatus | null;
  getActivePermissions: () => PermissionRequest[];
  getActiveQuestions: () => QuestionRequest[];
  getActiveSessionStatuses: () => Record<string, SessionStatus>;
  getActiveTodos: () => Todo[];
  getRecentSessionsAcrossWorkspaces: (limit: number) => SessionWithWorkspace[];
  getUnifiedSessionStatuses: () => Record<string, SessionStatus>;
  getActiveQuestionSessionIds: () => Set<string>;
  getUnifiedQuestionSessionIds: () => Set<string>;
  getUnifiedLastViewedAt: () => Record<string, number>;
  getUnifiedPinnedSessionIds: () => Set<string>;
  getActivePinnedSessionIds: () => Set<string>;
  setSessionAgent: (
    sessionId: string,
    workspaceId: string,
    agent: string,
  ) => void;
  getSessionAgent: (sessionId: string) => string | null;
  setSessionModel: (
    sessionId: string,
    workspaceId: string,
    model: { providerID: string; modelID: string },
  ) => void;
  clearSessionModel: (sessionId: string, workspaceId: string) => void;
  getSessionModel: (
    sessionId: string,
  ) => { providerID: string; modelID: string } | null;
  setSessionVariant: (
    sessionId: string,
    workspaceId: string,
    variant: string,
  ) => void;
  clearSessionVariant: (sessionId: string, workspaceId: string) => void;
  getSessionVariant: (sessionId: string) => string | null;

  fetchCachedSessions: (workspaceId: string) => Promise<void>;
  fetchPinnedSessions: (workspaceId: string) => Promise<void>;
  pinSession: (sessionId: string, workspaceId: string) => Promise<void>;
  unpinSession: (sessionId: string, workspaceId: string) => Promise<void>;
  isSessionPinned: (sessionId: string, workspaceId: string) => boolean;
  getPinnedSessionIds: (workspaceId: string) => Set<string>;

  fetchSessionNotes: (workspaceId: string) => Promise<void>;
  setSessionNote: (
    sessionId: string,
    workspaceId: string,
    note: string,
  ) => Promise<void>;
  clearSessionNote: (sessionId: string, workspaceId: string) => Promise<void>;
  getActiveSessionNotes: () => Record<string, string>;
  getUnifiedSessionNotes: () => Record<string, string>;
}

function buildProxyUrl(
  path: string,
  workspaceId?: string,
  extraParams?: Record<string, string>,
): string {
  const params = new URLSearchParams();
  if (workspaceId) params.set("workspaceId", workspaceId);
  if (extraParams) {
    for (const [key, value] of Object.entries(extraParams)) {
      params.set(key, value);
    }
  }
  const query = params.toString();
  return `/api/opencode/${path}${query ? `?${query}` : ""}`;
}

function extractErrorString(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const e = error as Record<string, unknown>;
    if (typeof e.error === "string") return e.error;
    if (typeof e.detail === "string") return e.detail;
    if (typeof e.message === "string") return e.message;
    if (Array.isArray(e.errors)) {
      const first = e.errors[0];
      if (first && typeof first === "object") {
        const fe = first as Record<string, unknown>;
        if (typeof fe.message === "string") return fe.message;
      }
      return JSON.stringify(e.errors);
    }
    return JSON.stringify(error);
  }
  return "An unknown error occurred";
}

function updateWorkspace(
  state: ChatState,
  workspaceId: string,
  updater: (ws: WorkspaceState) => Partial<WorkspaceState>,
): Partial<ChatState> {
  const existing = state.workspaceStates[workspaceId] ?? emptyWorkspaceState();
  return {
    workspaceStates: {
      ...state.workspaceStates,
      [workspaceId]: { ...existing, ...updater(existing) },
    },
  };
}

// Moves a session to the front of the LRU access list and evicts the oldest
// session's messages when the list exceeds MAX_CACHED_SESSIONS.
function touchLru(
  state: ChatState,
  sessionId: string,
  workspaceId: string,
): Partial<ChatState> {
  const filtered = state.messageAccessOrder.filter(
    (e) => e.sessionId !== sessionId,
  );
  const next: LruEntry[] = [{ sessionId, workspaceId }, ...filtered];

  if (next.length <= MAX_CACHED_SESSIONS) {
    return { messageAccessOrder: next };
  }

  const evicted = next.slice(MAX_CACHED_SESSIONS);
  const kept = next.slice(0, MAX_CACHED_SESSIONS);
  const nextWorkspaceStates = { ...state.workspaceStates };

  for (const entry of evicted) {
    const ws = nextWorkspaceStates[entry.workspaceId];
    if (!ws?.messages[entry.sessionId]) continue;
    const { [entry.sessionId]: _, ...remainingMessages } = ws.messages;
    nextWorkspaceStates[entry.workspaceId] = {
      ...ws,
      messages: remainingMessages,
    };
  }

  return { messageAccessOrder: kept, workspaceStates: nextWorkspaceStates };
}

interface PersistedChatState {
  activeSessionId: string | null;
  workspaceStates: Record<
    string,
    {
      sessionAgents: Record<string, string>;
      sessionModels: Record<string, { providerID: string; modelID: string }>;
      sessionVariants: Record<string, string>;
      lastViewedAt: Record<string, number>;
    }
  >;
}

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      workspaceStates: {},
      commands: [],
      messageAccessOrder: [],
      queuedMessages: new Map(),
      queuedWorkspaceIds: new Set(),
      activeWorkspaceId: null,
      activeSessionId: null,
      streamingError: null,
      streamingPollInterval: null,
      optimisticStreamingSessionId: null,
      globalEventSource: null,
      sseReconnectAttempts: 0,
      sseReconnectTimer: null,
      sseWorkspaceIds: [],

      setActiveSession: (sessionId) => {
        set({ activeSessionId: sessionId });
        if (sessionId) {
          const wsId = get().activeWorkspaceId;
          if (wsId) {
            set((state) => {
              const wsUpdate = updateWorkspace(state, wsId, (ws) => ({
                lastViewedAt: { ...ws.lastViewedAt, [sessionId]: Date.now() },
              }));
              const stateAfterWsUpdate = { ...state, ...wsUpdate };
              const lruUpdate = touchLru(stateAfterWsUpdate, sessionId, wsId);
              return { ...wsUpdate, ...lruUpdate };
            });
          }
        }
      },

      setActiveWorkspaceId: (workspaceId) => {
        const current = get().activeWorkspaceId;
        if (current === workspaceId) return;

        set({
          activeWorkspaceId: workspaceId,
          activeSessionId: null,
          streamingError: null,
        });

        if (workspaceId) {
          const ws = get().workspaceStates[workspaceId];
          if (!ws || Object.keys(ws.sessions).length === 0) {
            get().fetchSessions(workspaceId);
          }
        }
      },

      fetchSessions: async (workspaceId) => {
        if (_fetchSessionsInFlight.has(workspaceId)) return;
        _fetchSessionsInFlight.add(workspaceId);
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 10_000);
          const response = await fetch(buildProxyUrl("session", workspaceId), {
            signal: controller.signal,
          });
          clearTimeout(timeoutId);
          if (!response.ok) {
            console.warn(
              `[chat] fetchSessions failed: ${response.status}, falling back to cache`,
            );
            await get().fetchCachedSessions(workspaceId);
            set((state) => {
              if (state.workspaceStates[workspaceId]?.sessionsLoaded)
                return state;
              return updateWorkspace(state, workspaceId, () => ({
                sessionsLoaded: true,
              }));
            });
            return;
          }

          const data: Session[] = await response.json();
          const sessionsMap: Record<string, Session> = {};
          for (const session of data) {
            sessionsMap[session.id] = session;
          }
          set((state) => {
            const wsUpdate = updateWorkspace(state, workspaceId, () => ({
              sessions: sessionsMap,
              sessionsLoaded: true,
            }));
            // Prune orphaned sub-records for sessions that no longer exist
            const ws = wsUpdate.workspaceStates?.[workspaceId];
            if (!ws) return wsUpdate;
            const validIds = new Set(Object.keys(sessionsMap));
            const prune = <T>(record: Record<string, T>): Record<string, T> => {
              const pruned: Record<string, T> = {};
              for (const id of Object.keys(record)) {
                if (validIds.has(id)) pruned[id] = record[id];
              }
              return pruned;
            };
            return {
              workspaceStates: {
                ...wsUpdate.workspaceStates,
                [workspaceId]: {
                  ...ws,
                  sessionStatuses: prune(ws.sessionStatuses),
                  todos: prune(ws.todos),
                  sessionAgents: prune(ws.sessionAgents),
                  sessionModels: prune(ws.sessionModels),
                  sessionVariants: prune(ws.sessionVariants),
                  lastViewedAt: prune(ws.lastViewedAt),
                },
              },
            };
          });

          fetch("/api/sessions/cache", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ workspaceId, sessions: data }),
          }).catch(() => {});

          // Auto-select the most recently updated session if none is selected for this workspace
          const { activeWorkspaceId, activeSessionId } = get();
          if (activeWorkspaceId === workspaceId && !activeSessionId) {
            const mostRecent = data
              .filter((s) => !s.parentID)
              .sort((a, b) => b.time.updated - a.time.updated)[0];
            if (mostRecent) {
              get().setActiveSession(mostRecent.id);
              get().refreshActiveSessionStatus(workspaceId);
            }
          }
        } catch (error) {
          console.warn("[chat] fetchSessions error:", error);
          await get().fetchCachedSessions(workspaceId);
          set((state) => {
            if (state.workspaceStates[workspaceId]?.sessionsLoaded)
              return state;
            return updateWorkspace(state, workspaceId, () => ({
              sessionsLoaded: true,
            }));
          });
        } finally {
          _fetchSessionsInFlight.delete(workspaceId);
        }
      },

      fetchCommands: async (workspaceId) => {
        try {
          const response = await fetch(buildProxyUrl("command", workspaceId));
          if (!response.ok) {
            console.warn(`[chat] fetchCommands failed: ${response.status}`);
            return;
          }

          const data: Command[] = await response.json();
          set({ commands: data });
        } catch (error) {
          console.warn("[chat] fetchCommands error:", error);
        }
      },

      createSession: async (workspaceId) => {
        try {
          const response = await fetch(buildProxyUrl("session", workspaceId), {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({}),
          });
          if (!response.ok) return null;

          const session: Session = await response.json();
          set((state) => ({
            activeSessionId: session.id,
            ...updateWorkspace(state, workspaceId, (ws) => ({
              sessions: { ...ws.sessions, [session.id]: session },
              messages: { ...ws.messages, [session.id]: [] },
            })),
          }));
          return session;
        } catch {
          return null;
        }
      },

      deleteSession: async (sessionId, workspaceId) => {
        try {
          await fetch(buildProxyUrl(`session/${sessionId}`, workspaceId), {
            method: "DELETE",
          });
          sessionSourceWorkspace.delete(sessionId);
          set((state) => {
            const ws =
              state.workspaceStates[workspaceId] ?? emptyWorkspaceState();
            const { [sessionId]: _s, ...remainingSessions } = ws.sessions;
            const { [sessionId]: _m, ...remainingMessages } = ws.messages;
            const { [sessionId]: _o, ...remainingOptimistic } =
              ws.optimisticMessageIds;
            const { [sessionId]: _st, ...remainingStatuses } =
              ws.sessionStatuses;
            const { [sessionId]: _t, ...remainingTodos } = ws.todos;
            const { [sessionId]: _a, ...remainingSessionAgents } =
              ws.sessionAgents;
            const { [sessionId]: _sm, ...remainingSessionModels } =
              ws.sessionModels;
            const { [sessionId]: _sv, ...remainingSessionVariants } =
              ws.sessionVariants;
            const { [sessionId]: _lv, ...remainingLastViewedAt } =
              ws.lastViewedAt;

            let nextActiveSessionId = state.activeSessionId;
            if (state.activeSessionId === sessionId) {
              const nextSession = Object.values(remainingSessions)
                .filter((s) => !s.parentID)
                .sort((a, b) => b.time.updated - a.time.updated)[0];
              nextActiveSessionId = nextSession?.id ?? null;
            }

            return {
              activeSessionId: nextActiveSessionId,
              messageAccessOrder: state.messageAccessOrder.filter(
                (e) => e.sessionId !== sessionId,
              ),
              workspaceStates: {
                ...state.workspaceStates,
                [workspaceId]: {
                  ...ws,
                  sessions: remainingSessions,
                  messages: remainingMessages,
                  optimisticMessageIds: remainingOptimistic,
                  sessionStatuses: remainingStatuses,
                  todos: remainingTodos,
                  sessionAgents: remainingSessionAgents,
                  sessionModels: remainingSessionModels,
                  sessionVariants: remainingSessionVariants,
                  lastViewedAt: remainingLastViewedAt,
                },
              },
            };
          });
        } catch {
          // Silently fail
        }
      },

      removeSessionLocal: (sessionId, workspaceId) => {
        const state = get();
        const ws = state.workspaceStates[workspaceId];
        if (!ws || !(sessionId in ws.sessions)) return null;

        sessionSourceWorkspace.delete(sessionId);

        const snapshot: SessionSnapshot = {
          sessionId,
          workspaceId,
          session: ws.sessions[sessionId],
          messages: ws.messages[sessionId] ?? [],
          optimisticMessageId: ws.optimisticMessageIds[sessionId],
          sessionStatus: ws.sessionStatuses[sessionId],
          todos: ws.todos[sessionId],
          sessionAgent: ws.sessionAgents[sessionId],
          sessionModel: ws.sessionModels[sessionId],
          sessionVariant: ws.sessionVariants?.[sessionId],
          lastViewedAt: ws.lastViewedAt[sessionId],
          wasActive: state.activeSessionId === sessionId,
        };

        const { [sessionId]: _s, ...remainingSessions } = ws.sessions;
        const { [sessionId]: _m, ...remainingMessages } = ws.messages;
        const { [sessionId]: _o, ...remainingOptimistic } =
          ws.optimisticMessageIds;
        const { [sessionId]: _st, ...remainingStatuses } = ws.sessionStatuses;
        const { [sessionId]: _t, ...remainingTodos } = ws.todos;
        const { [sessionId]: _a, ...remainingSessionAgents } = ws.sessionAgents;
        const { [sessionId]: _sm, ...remainingSessionModels } =
          ws.sessionModels;
        const { [sessionId]: _sv, ...remainingSessionVariants } =
          ws.sessionVariants;
        const { [sessionId]: _lv, ...remainingLastViewedAt } = ws.lastViewedAt;

        let nextActiveSessionId = state.activeSessionId;
        if (state.activeSessionId === sessionId) {
          const nextSession = Object.values(remainingSessions)
            .filter((s) => !s.parentID)
            .sort((a, b) => b.time.updated - a.time.updated)[0];
          nextActiveSessionId = nextSession?.id ?? null;
        }

        set({
          activeSessionId: nextActiveSessionId,
          messageAccessOrder: state.messageAccessOrder.filter(
            (e) => e.sessionId !== sessionId,
          ),
          workspaceStates: {
            ...state.workspaceStates,
            [workspaceId]: {
              ...ws,
              sessions: remainingSessions,
              messages: remainingMessages,
              optimisticMessageIds: remainingOptimistic,
              sessionStatuses: remainingStatuses,
              todos: remainingTodos,
              sessionAgents: remainingSessionAgents,
              sessionModels: remainingSessionModels,
              sessionVariants: remainingSessionVariants,
              lastViewedAt: remainingLastViewedAt,
            },
          },
        });

        return snapshot;
      },

      restoreSessionLocal: (snapshot) => {
        set((state) => {
          const ws =
            state.workspaceStates[snapshot.workspaceId] ??
            emptyWorkspaceState();
          const restored: Partial<WorkspaceState> = {
            sessions: {
              ...ws.sessions,
              [snapshot.sessionId]: snapshot.session,
            },
            messages: {
              ...ws.messages,
              [snapshot.sessionId]: snapshot.messages,
            },
          };
          if (snapshot.optimisticMessageId !== undefined) {
            restored.optimisticMessageIds = {
              ...ws.optimisticMessageIds,
              [snapshot.sessionId]: snapshot.optimisticMessageId,
            };
          }
          if (snapshot.sessionStatus !== undefined) {
            restored.sessionStatuses = {
              ...ws.sessionStatuses,
              [snapshot.sessionId]: snapshot.sessionStatus,
            };
          }
          if (snapshot.todos !== undefined) {
            restored.todos = {
              ...ws.todos,
              [snapshot.sessionId]: snapshot.todos,
            };
          }
          if (snapshot.sessionAgent !== undefined) {
            restored.sessionAgents = {
              ...ws.sessionAgents,
              [snapshot.sessionId]: snapshot.sessionAgent,
            };
          }
          if (snapshot.sessionModel !== undefined) {
            restored.sessionModels = {
              ...ws.sessionModels,
              [snapshot.sessionId]: snapshot.sessionModel,
            };
          }
          if (snapshot.sessionVariant !== undefined) {
            restored.sessionVariants = {
              ...ws.sessionVariants,
              [snapshot.sessionId]: snapshot.sessionVariant,
            };
          }
          if (snapshot.lastViewedAt !== undefined) {
            restored.lastViewedAt = {
              ...ws.lastViewedAt,
              [snapshot.sessionId]: snapshot.lastViewedAt,
            };
          }

          return {
            activeSessionId: snapshot.wasActive
              ? snapshot.sessionId
              : state.activeSessionId,
            workspaceStates: {
              ...state.workspaceStates,
              [snapshot.workspaceId]: { ...ws, ...restored },
            },
          };
        });
      },

      fetchMessages: async (sessionId, workspaceId) => {
        const hasInMemory =
          (get().workspaceStates[workspaceId]?.messages[sessionId]?.length ??
            0) > 0;

        if (!hasInMemory) {
          try {
            const cacheResponse = await fetch(
              `/api/sessions/cache/messages?sessionId=${sessionId}&workspaceId=${workspaceId}`,
            );
            if (cacheResponse.ok) {
              const cached = await cacheResponse.json();
              if (cached?.messages?.length > 0) {
                // Only populate if still empty (avoid overwriting SSE-delivered data)
                set((state) => {
                  const ws = state.workspaceStates[workspaceId];
                  if (ws?.messages[sessionId]?.length) return state;
                  const wsUpdate = updateWorkspace(state, workspaceId, () => ({
                    messages: {
                      ...ws?.messages,
                      [sessionId]: cached.messages,
                    },
                  }));
                  const stateAfterWsUpdate = { ...state, ...wsUpdate };
                  const lruUpdate = touchLru(
                    stateAfterWsUpdate,
                    sessionId,
                    workspaceId,
                  );
                  return { ...wsUpdate, ...lruUpdate };
                });
              }
            }
          } catch {
            // Best effort — proceed to remote fetch
          }
        }

        try {
          const response = await fetch(
            buildProxyUrl(`session/${sessionId}/message`, workspaceId),
          );
          if (!response.ok) {
            set((state) =>
              updateWorkspace(state, workspaceId, (ws) => ({
                messages: {
                  ...ws.messages,
                  [sessionId]: ws.messages[sessionId] ?? [],
                },
              })),
            );
            return;
          }

          const data: MessageWithParts[] = await response.json();
          set((state) => {
            const wsUpdate = updateWorkspace(state, workspaceId, (ws) => {
              const { [sessionId]: _, ...remainingOptimistic } =
                ws.optimisticMessageIds;
              // Seed session agent from the last user message if not already tracked
              const seededAgent = ws.sessionAgents[sessionId]
                ? {}
                : (() => {
                    const lastUserMessage = [...data]
                      .reverse()
                      .find((m) => m.info.role === "user");
                    const agent =
                      lastUserMessage?.info.role === "user"
                        ? lastUserMessage.info.agent
                        : undefined;
                    return agent
                      ? {
                          sessionAgents: {
                            ...ws.sessionAgents,
                            [sessionId]: agent,
                          },
                        }
                      : {};
                  })();
              return {
                optimisticMessageIds: remainingOptimistic,
                messages: { ...ws.messages, [sessionId]: data },
                ...seededAgent,
              };
            });
            const stateAfterWsUpdate = { ...state, ...wsUpdate };
            const lruUpdate = touchLru(
              stateAfterWsUpdate,
              sessionId,
              workspaceId,
            );
            return { ...wsUpdate, ...lruUpdate };
          });

          fetch("/api/sessions/cache/messages", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ sessionId, workspaceId, messages: data }),
          }).catch(() => {});
        } catch {
          set((state) =>
            updateWorkspace(state, workspaceId, (ws) => ({
              messages: {
                ...ws.messages,
                [sessionId]: ws.messages[sessionId] ?? [],
              },
            })),
          );
        }
      },

      summarizeSession: async (sessionId, workspaceId, model) => {
        try {
          const response = await fetch(
            buildProxyUrl(`session/${sessionId}/summarize`, workspaceId),
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(
                model
                  ? { providerID: model.providerID, modelID: model.modelID }
                  : {},
              ),
            },
          );
          if (!response.ok) {
            let message = "Failed to compact session";
            try {
              const body = await response.json();
              const extracted = extractErrorString(body);
              if (extracted) message = extracted;
            } catch {
              // Response wasn't JSON — use default message
            }
            set({ streamingError: message });
          }
        } catch (error) {
          set({ streamingError: extractErrorString(error) });
        }
      },

      revertSession: async (sessionId, workspaceId, messageID) => {
        const ws = get().workspaceStates[workspaceId];
        const msgs = ws?.messages[sessionId] ?? [];
        const idx = msgs.findIndex((m) => m.info.id === messageID);

        let revertedText: string | null = null;
        if (idx >= 0) {
          const target = msgs[idx];
          revertedText = target.parts
            .filter((p) => p.type === "text" && "text" in p)
            .map((p) => (p as { text: string }).text)
            .join("");

          set((state) =>
            updateWorkspace(state, workspaceId, (w) => ({
              messages: {
                ...w.messages,
                [sessionId]: (w.messages[sessionId] ?? []).slice(0, idx),
              },
            })),
          );
        }

        try {
          await fetch(
            buildProxyUrl(`session/${sessionId}/revert`, workspaceId),
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ messageID }),
            },
          );
        } catch {
          if (idx >= 0) {
            set((state) =>
              updateWorkspace(state, workspaceId, () => ({
                messages: { ...ws!.messages },
              })),
            );
          }
        }

        return revertedText;
      },

      sendMessage: async (
        sessionId,
        text,
        workspaceId,
        model,
        agent,
        variant,
        attachments,
      ) => {
        const isAlreadyStreaming = get().getStreamingStatus() === "streaming";
        if (!isAlreadyStreaming) {
          set({ optimisticStreamingSessionId: sessionId });
        }
        set({ streamingError: null });

        const optimisticId = `optimistic-${Date.now()}`;
        const queuedMessage: QueuedMessage = {
          sessionId,
          text,
          workspaceId,
          model,
          agent,
          variant,
          attachments,
          optimisticMessageId: optimisticId,
        };
        const optimisticMessage: MessageWithParts = {
          info: {
            id: optimisticId,
            sessionID: sessionId,
            role: "user",
            time: { created: Date.now() },
            agent: agent ?? "",
            model: model ?? { providerID: "", modelID: "" },
          },
          parts: [
            {
              id: `${optimisticId}-part`,
              sessionID: sessionId,
              messageID: optimisticId,
              type: "text",
              text,
            },
          ],
        };

        set((state) =>
          updateWorkspace(state, workspaceId, (ws) => ({
            optimisticMessageIds: {
              ...ws.optimisticMessageIds,
              [sessionId]: optimisticId,
            },
            messages: {
              ...ws.messages,
              [sessionId]: [
                ...(ws.messages[sessionId] ?? []),
                optimisticMessage,
              ],
            },
          })),
        );

        try {
          const parts: Array<Record<string, unknown>> = [
            { type: "text", text },
          ];
          if (attachments?.length) {
            for (const att of attachments) {
              parts.push({
                type: "file",
                mime: att.mime,
                url: att.dataUrl,
                filename: att.filename,
              });
            }
          }
          const body: Record<string, unknown> = {
            parts,
          };
          if (model) body.model = model;
          if (agent) body.agent = agent;
          if (variant) body.variant = variant;

          const response = await fetch(
            buildProxyUrl(`session/${sessionId}/prompt_async`, workspaceId),
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(body),
            },
          );

          if (!response.ok) {
            if (response.status === 502) {
              set((state) => {
                const nextQueuedMessages = new Map(state.queuedMessages);
                const existingForWorkspace =
                  nextQueuedMessages.get(workspaceId) ?? [];
                nextQueuedMessages.set(workspaceId, [
                  ...existingForWorkspace,
                  queuedMessage,
                ]);
                const nextQueuedWorkspaceIds = new Set(
                  state.queuedWorkspaceIds,
                );
                nextQueuedWorkspaceIds.add(workspaceId);
                return {
                  queuedMessages: nextQueuedMessages,
                  queuedWorkspaceIds: nextQueuedWorkspaceIds,
                };
              });
              set({
                optimisticStreamingSessionId: isAlreadyStreaming
                  ? get().optimisticStreamingSessionId
                  : null,
              });
              toast("Message queued - workspace is starting...");
              return;
            }

            const error = await response
              .json()
              .catch(() => ({ error: "Failed to send message" }));
            set((state) =>
              updateWorkspace(state, workspaceId, (ws) => {
                const { [sessionId]: _, ...remainingOptimistic } =
                  ws.optimisticMessageIds;
                return {
                  optimisticMessageIds: remainingOptimistic,
                  messages: {
                    ...ws.messages,
                    [sessionId]: (ws.messages[sessionId] ?? []).filter(
                      (m) => m.info.id !== optimisticId,
                    ),
                  },
                };
              }),
            );
            set({
              optimisticStreamingSessionId: isAlreadyStreaming
                ? get().optimisticStreamingSessionId
                : null,
              streamingError: extractErrorString(error),
            });
            return;
          }
          get().startStreamingPoll(workspaceId);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Failed to send message";
          set((state) =>
            updateWorkspace(state, workspaceId, (ws) => {
              const { [sessionId]: _, ...remainingOptimistic } =
                ws.optimisticMessageIds;
              return {
                optimisticMessageIds: remainingOptimistic,
                messages: {
                  ...ws.messages,
                  [sessionId]: (ws.messages[sessionId] ?? []).filter(
                    (m) => m.info.id !== optimisticId,
                  ),
                },
              };
            }),
          );
          set({
            optimisticStreamingSessionId: isAlreadyStreaming
              ? get().optimisticStreamingSessionId
              : null,
            streamingError: message,
          });
        }
      },

      flushQueuedMessages: async (workspaceId) => {
        if (flushingQueuedWorkspaces.has(workspaceId)) return;

        const queued = get().queuedMessages.get(workspaceId) ?? [];
        if (queued.length === 0) {
          set((state) => {
            if (!state.queuedWorkspaceIds.has(workspaceId)) return state;
            const nextQueuedWorkspaceIds = new Set(state.queuedWorkspaceIds);
            nextQueuedWorkspaceIds.delete(workspaceId);
            return { queuedWorkspaceIds: nextQueuedWorkspaceIds };
          });
          return;
        }

        flushingQueuedWorkspaces.add(workspaceId);
        set((state) => {
          const nextQueuedMessages = new Map(state.queuedMessages);
          nextQueuedMessages.delete(workspaceId);
          const nextQueuedWorkspaceIds = new Set(state.queuedWorkspaceIds);
          nextQueuedWorkspaceIds.delete(workspaceId);
          return {
            queuedMessages: nextQueuedMessages,
            queuedWorkspaceIds: nextQueuedWorkspaceIds,
          };
        });

        try {
          for (const message of queued) {
            set((state) =>
              updateWorkspace(state, workspaceId, (ws) => {
                const {
                  [message.sessionId]: optimisticForSession,
                  ...remaining
                } = ws.optimisticMessageIds;
                return {
                  optimisticMessageIds:
                    optimisticForSession === message.optimisticMessageId
                      ? remaining
                      : ws.optimisticMessageIds,
                  messages: {
                    ...ws.messages,
                    [message.sessionId]: (
                      ws.messages[message.sessionId] ?? []
                    ).filter(
                      (entry) => entry.info.id !== message.optimisticMessageId,
                    ),
                  },
                };
              }),
            );

            await get().sendMessage(
              message.sessionId,
              message.text,
              message.workspaceId,
              message.model,
              message.agent,
              message.variant,
              message.attachments,
            );
          }
        } finally {
          flushingQueuedWorkspaces.delete(workspaceId);
        }
      },

      hasQueuedMessages: (workspaceId) => {
        return (get().queuedMessages.get(workspaceId)?.length ?? 0) > 0;
      },

      executeCommand: async (
        sessionId,
        workspaceId,
        command,
        args,
        model,
        agent,
        variant,
      ) => {
        const isAlreadyStreaming = get().getStreamingStatus() === "streaming";
        if (!isAlreadyStreaming) {
          set({ optimisticStreamingSessionId: sessionId });
        }
        set({ streamingError: null });

        const optimisticId = `optimistic-${Date.now()}`;
        const commandText = `/${command}${args ? ` ${args}` : ""}`;
        const optimisticMessage: MessageWithParts = {
          info: {
            id: optimisticId,
            sessionID: sessionId,
            role: "user",
            time: { created: Date.now() },
            agent: agent ?? "",
            model: model ?? { providerID: "", modelID: "" },
          },
          parts: [
            {
              id: `${optimisticId}-part`,
              sessionID: sessionId,
              messageID: optimisticId,
              type: "text",
              text: commandText,
            },
          ],
        };

        set((state) =>
          updateWorkspace(state, workspaceId, (ws) => ({
            optimisticMessageIds: {
              ...ws.optimisticMessageIds,
              [sessionId]: optimisticId,
            },
            messages: {
              ...ws.messages,
              [sessionId]: [
                ...(ws.messages[sessionId] ?? []),
                optimisticMessage,
              ],
            },
          })),
        );

        try {
          const body: Record<string, unknown> = {
            command,
            arguments: args,
          };
          if (model) body.model = `${model.providerID}/${model.modelID}`;
          if (agent) body.agent = agent;
          if (variant) body.variant = variant;

          const response = await fetch(
            buildProxyUrl(`session/${sessionId}/command`, workspaceId),
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(body),
            },
          );

          if (!response.ok) {
            const error = await response
              .json()
              .catch(() => ({ error: "Failed to execute command" }));
            set((state) =>
              updateWorkspace(state, workspaceId, (ws) => {
                const { [sessionId]: _, ...remainingOptimistic } =
                  ws.optimisticMessageIds;
                return {
                  optimisticMessageIds: remainingOptimistic,
                  messages: {
                    ...ws.messages,
                    [sessionId]: (ws.messages[sessionId] ?? []).filter(
                      (m) => m.info.id !== optimisticId,
                    ),
                  },
                };
              }),
            );
            set({
              optimisticStreamingSessionId: isAlreadyStreaming
                ? get().optimisticStreamingSessionId
                : null,
              streamingError: extractErrorString(error),
            });
            return;
          }
          get().startStreamingPoll(workspaceId);
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "Failed to execute command";
          set((state) =>
            updateWorkspace(state, workspaceId, (ws) => {
              const { [sessionId]: _, ...remainingOptimistic } =
                ws.optimisticMessageIds;
              return {
                optimisticMessageIds: remainingOptimistic,
                messages: {
                  ...ws.messages,
                  [sessionId]: (ws.messages[sessionId] ?? []).filter(
                    (m) => m.info.id !== optimisticId,
                  ),
                },
              };
            }),
          );
          set({
            optimisticStreamingSessionId: isAlreadyStreaming
              ? get().optimisticStreamingSessionId
              : null,
            streamingError: message,
          });
        }
      },

      abortSession: async (sessionId, workspaceId) => {
        try {
          await fetch(
            buildProxyUrl(`session/${sessionId}/abort`, workspaceId),
            {
              method: "POST",
            },
          );
          // session.idle SSE will update sessionStatuses; optimistic clear is safe here
          set({ optimisticStreamingSessionId: null });
          get().clearStreamingPoll();
        } catch {
          // Best effort
        }
      },

      respondToPermission: async (
        sessionId,
        permissionId,
        response,
        workspaceId,
      ) => {
        try {
          const serverResponse =
            response === "allow"
              ? "once"
              : response === "always"
                ? "always"
                : "reject";
          await fetch(
            buildProxyUrl(
              `session/${sessionId}/permissions/${permissionId}`,
              workspaceId,
            ),
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ response: serverResponse }),
            },
          );
          // Optimistically remove — the permission.replied SSE event will also clean up
          set((state) =>
            updateWorkspace(state, workspaceId, (ws) => ({
              permissions: ws.permissions.filter((p) => p.id !== permissionId),
            })),
          );
        } catch {
          // Best effort
        }
      },

      replyToQuestion: async (requestId, answers, workspaceId) => {
        try {
          await fetch(
            buildProxyUrl(`question/${requestId}/reply`, workspaceId),
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ answers }),
            },
          );
          set((state) =>
            updateWorkspace(state, workspaceId, (ws) => ({
              questions: ws.questions.filter((q) => q.id !== requestId),
            })),
          );
        } catch (err) {
          console.warn("[chat] Failed to reply to question:", err);
        }
      },

      rejectQuestion: async (requestId, workspaceId) => {
        try {
          await fetch(
            buildProxyUrl(`question/${requestId}/reject`, workspaceId),
            {
              method: "POST",
            },
          );
          set((state) =>
            updateWorkspace(state, workspaceId, (ws) => ({
              questions: ws.questions.filter((q) => q.id !== requestId),
            })),
          );
        } catch (err) {
          console.warn("[chat] Failed to reject question:", err);
        }
      },

      connectGlobalSSE: (workspaceIds) => {
        const existing = get().globalEventSource;
        const currentIds = get().sseWorkspaceIds;

        // Skip reconnection if already connected with the same workspace IDs
        if (
          existing &&
          existing.readyState !== EventSource.CLOSED &&
          workspaceIds.length === currentIds.length &&
          workspaceIds.every((id, i) => id === currentIds[i])
        ) {
          return;
        }

        if (workspaceIds.length === 0) {
          if (existing) existing.close();
          set({ globalEventSource: null, sseWorkspaceIds: [] });
          return;
        }

        const pendingTimer = get().sseReconnectTimer;
        if (pendingTimer !== null) {
          clearTimeout(pendingTimer);
          set({ sseReconnectTimer: null });
        }

        // Overlap: both EventSources run concurrently (~100-500ms) until new one opens.
        // Safe because handleEvent is idempotent — duplicate events are harmless.
        const oldEventSource = existing;

        const url = `/api/opencode/events?workspaceIds=${workspaceIds.join(",")}`;
        const newEventSource = new EventSource(url);

        const safetyTimeout = oldEventSource
          ? setTimeout(() => {
              if (oldEventSource.readyState !== EventSource.CLOSED) {
                console.warn(
                  "[chat] SSE overlap safety timeout — closing old connection",
                );
                oldEventSource.close();
              }
            }, 5000)
          : null;

        newEventSource.onopen = () => {
          if (
            oldEventSource &&
            oldEventSource.readyState !== EventSource.CLOSED
          ) {
            oldEventSource.close();
          }
          if (safetyTimeout) clearTimeout(safetyTimeout);

          console.log(
            `[chat] Global SSE connected for ${workspaceIds.length} workspace(s)`,
          );
          set({ sseReconnectAttempts: 0 });

          if (sseOnopenAbortController) sseOnopenAbortController.abort();
          sseOnopenAbortController = new AbortController();
          const { signal } = sseOnopenAbortController;

          if (get().streamingError) {
            set({ streamingError: null });
          }

          const { activeWorkspaceId, activeSessionId } = get();
          if (activeWorkspaceId && activeSessionId) {
            get().fetchMessages(activeSessionId, activeWorkspaceId);
            get().refreshActiveSessionStatus(activeWorkspaceId);
          }

          for (const wsId of workspaceIds) {
            fetch(buildProxyUrl("permission", wsId), { signal })
              .then((res) => res.json())
              .then((permissions: PermissionRequest[]) => {
                if (!Array.isArray(permissions)) return;
                const serverIds = new Set(permissions.map((p) => p.id));
                set((state) =>
                  updateWorkspace(state, wsId, (ws) => {
                    const known = new Set(ws.permissions.map((p) => p.id));
                    const incoming = permissions.filter(
                      (p) => !known.has(p.id),
                    );
                    const reconciled = ws.permissions.filter((p) =>
                      serverIds.has(p.id),
                    );
                    return { permissions: [...reconciled, ...incoming] };
                  }),
                );
              })
              .catch(() => {});

            fetch(buildProxyUrl("question", wsId), { signal })
              .then((res) => res.json())
              .then((questions: QuestionRequest[]) => {
                if (!Array.isArray(questions)) return;
                const serverIds = new Set(questions.map((q) => q.id));
                set((state) =>
                  updateWorkspace(state, wsId, (ws) => {
                    const known = new Set(ws.questions.map((q) => q.id));
                    const incoming = questions.filter((q) => !known.has(q.id));
                    const reconciled = ws.questions.filter((q) =>
                      serverIds.has(q.id),
                    );
                    return { questions: [...reconciled, ...incoming] };
                  }),
                );
              })
              .catch(() => {});
          }
        };

        newEventSource.onmessage = (evt) => {
          try {
            const { workspaceId, event } = JSON.parse(evt.data) as {
              workspaceId: string;
              event: Record<string, unknown>;
            };
            get().handleEvent(event, workspaceId);
          } catch {
            // Ignore malformed events
          }
        };

        newEventSource.onerror = () => {
          newEventSource.close();
          if (
            oldEventSource &&
            oldEventSource.readyState !== EventSource.CLOSED
          ) {
            oldEventSource.close();
          }
          if (safetyTimeout) clearTimeout(safetyTimeout);

          const attempts = get().sseReconnectAttempts;
          const MAX_RECONNECT_ATTEMPTS = 20;
          const backoffMs = Math.min(1000 * 2 ** Math.min(attempts, 5), 30000);

          if (attempts >= MAX_RECONNECT_ATTEMPTS) {
            console.warn("[chat] Global SSE reconnect limit reached");
            set({ globalEventSource: null });
            return;
          }

          set({ sseReconnectAttempts: attempts + 1, globalEventSource: null });

          const timer = setTimeout(() => {
            set({ sseReconnectTimer: null });
            if (!get().globalEventSource) {
              get().connectGlobalSSE(workspaceIds);
            }
          }, backoffMs);
          set({ sseReconnectTimer: timer });
        };

        set({
          globalEventSource: newEventSource,
          sseWorkspaceIds: workspaceIds,
        });
      },

      disconnectGlobalSSE: () => {
        const { globalEventSource, sseReconnectTimer, sseWorkspaceIds } = get();
        if (globalEventSource) {
          globalEventSource.close();
        }
        if (sseReconnectTimer !== null) {
          clearTimeout(sseReconnectTimer);
        }
        if (sseOnopenAbortController) {
          sseOnopenAbortController.abort();
          sseOnopenAbortController = null;
        }
        set({
          globalEventSource: null,
          sseWorkspaceIds: [],
          sseReconnectTimer: null,
        });
        const disconnectedWsIds = new Set(sseWorkspaceIds);
        for (const [sessionId, wsId] of sessionSourceWorkspace) {
          if (disconnectedWsIds.has(wsId)) {
            sessionSourceWorkspace.delete(sessionId);
          }
        }
      },

      refreshActiveSessionStatus: async (workspaceId) => {
        const { activeSessionId } = get();
        if (!activeSessionId) return;

        try {
          const response = await fetch(
            buildProxyUrl("session/status", workspaceId),
          );
          if (!response.ok) return;

          const statusMap = (await response.json()) as Record<
            string,
            SessionStatus
          >;
          const status = statusMap[activeSessionId];

          if (!status) {
            // Session absent from the active status map → it's idle (server only lists non-idle sessions)
            set((state) =>
              updateWorkspace(state, workspaceId, (ws) => ({
                sessionStatuses: {
                  ...ws.sessionStatuses,
                  [activeSessionId]: { type: "idle" as const },
                },
              })),
            );
            set({ optimisticStreamingSessionId: null });
            get().clearStreamingPoll();
            return;
          }

          set((state) =>
            updateWorkspace(state, workspaceId, (ws) => ({
              sessionStatuses: {
                ...ws.sessionStatuses,
                [activeSessionId]: status,
              },
            })),
          );

          if (status.type === "idle") {
            // Clear optimistic flag and poll — session is confirmed done
            set({ optimisticStreamingSessionId: null });
            get().clearStreamingPoll();
          }
        } catch {
          // Best effort — SSE events will catch up
        }
      },

      handleVisibilityRestored: () => {
        // Cancel any pending scheduled flush (RAF or timeout) and force an immediate
        // synchronous flush. While the tab was hidden, the RAF-based flush was
        // suspended by the browser, leaving updates stranded in the buffer.
        if (partFlushHandle !== null) {
          cancelAnimationFrame(partFlushHandle);
          clearTimeout(partFlushHandle);
          partFlushHandle = null;
          partFlushScheduled = false;
        }
        flushPendingPartUpdates(set);

        if (messageFlushHandle !== null) {
          cancelAnimationFrame(messageFlushHandle);
          clearTimeout(messageFlushHandle);
          messageFlushHandle = null;
          messageFlushScheduled = false;
        }
        flushPendingMessageUpdates(set, get);

        const { activeWorkspaceId, activeSessionId } = get();

        // Re-sync session status in case the SSE idle event arrived while backgrounded
        if (activeWorkspaceId && activeSessionId) {
          get().refreshActiveSessionStatus(activeWorkspaceId);
        }

        const es = get().globalEventSource;
        if (es && es.readyState === EventSource.CLOSED) {
          get().connectGlobalSSE(get().sseWorkspaceIds);
        } else if (es && es.readyState === EventSource.OPEN) {
          // SSE stayed open while backgrounded — reconcile questions/permissions
          // in case events were missed or arrived before the tab could process them.
          for (const wsId of get().sseWorkspaceIds) {
            fetch(buildProxyUrl("permission", wsId))
              .then((res) => res.json())
              .then((permissions: PermissionRequest[]) => {
                if (!Array.isArray(permissions)) return;
                const serverIds = new Set(permissions.map((p) => p.id));
                set((state) =>
                  updateWorkspace(state, wsId, (ws) => {
                    const known = new Set(ws.permissions.map((p) => p.id));
                    const incoming = permissions.filter(
                      (p) => !known.has(p.id),
                    );
                    const reconciled = ws.permissions.filter((p) =>
                      serverIds.has(p.id),
                    );
                    return { permissions: [...reconciled, ...incoming] };
                  }),
                );
              })
              .catch(() => {});

            fetch(buildProxyUrl("question", wsId))
              .then((res) => res.json())
              .then((questions: QuestionRequest[]) => {
                if (!Array.isArray(questions)) return;
                const serverIds = new Set(questions.map((q) => q.id));
                set((state) =>
                  updateWorkspace(state, wsId, (ws) => {
                    const known = new Set(ws.questions.map((q) => q.id));
                    const incoming = questions.filter((q) => !known.has(q.id));
                    const reconciled = ws.questions.filter((q) =>
                      serverIds.has(q.id),
                    );
                    return { questions: [...reconciled, ...incoming] };
                  }),
                );
              })
              .catch(() => {});
          }
        }
      },

      handleEvent: (event, sourceWorkspaceId) => {
        const eventType = event.type as string;
        const properties = event.properties as
          | Record<string, unknown>
          | undefined;

        if (!properties) return;

        switch (eventType) {
          case "message.updated": {
            const info = properties.info as Message;
            if (!info) return;
            sessionSourceWorkspace.set(info.sessionID, sourceWorkspaceId);

            let byMessage = pendingMessageUpdates.get(info.sessionID);
            if (!byMessage) {
              byMessage = new Map();
              pendingMessageUpdates.set(info.sessionID, byMessage);
            }
            byMessage.set(info.id, { info, sourceWorkspaceId });

            schedulePendingMessageFlush(set, get);
            break;
          }

          case "message.removed": {
            const sessionID = properties.sessionID as string;
            const messageID = properties.messageID as string;
            const wsId =
              findWorkspaceForSession(get().workspaceStates, sessionID) ??
              sourceWorkspaceId;

            set((state) =>
              updateWorkspace(state, wsId, (ws) => ({
                messages: {
                  ...ws.messages,
                  [sessionID]: (ws.messages[sessionID] ?? []).filter(
                    (m) => m.info.id !== messageID,
                  ),
                },
              })),
            );
            break;
          }

          case "message.part.updated": {
            const part = properties.part as Part;
            if (!part) return;
            sessionSourceWorkspace.set(part.sessionID, sourceWorkspaceId);

            let byMessage = pendingPartUpdates.get(part.sessionID);
            if (!byMessage) {
              byMessage = new Map();
              pendingPartUpdates.set(part.sessionID, byMessage);
            }
            let byPart = byMessage.get(part.messageID);
            if (!byPart) {
              byPart = new Map();
              byMessage.set(part.messageID, byPart);
            }
            byPart.set(part.id, part);

            schedulePendingPartFlush(set);
            break;
          }

          case "message.part.removed": {
            const sessionID = properties.sessionID as string;
            const messageID = properties.messageID as string;
            const partID = properties.partID as string;
            const wsId =
              findWorkspaceForSession(get().workspaceStates, sessionID) ??
              sourceWorkspaceId;

            set((state) =>
              updateWorkspace(state, wsId, (ws) => ({
                messages: {
                  ...ws.messages,
                  [sessionID]: (ws.messages[sessionID] ?? []).map((m) =>
                    m.info.id === messageID
                      ? { ...m, parts: m.parts.filter((p) => p.id !== partID) }
                      : m,
                  ),
                },
              })),
            );
            break;
          }

          case "session.created":
          case "session.updated": {
            const info = properties.info as Session;
            if (!info) return;
            set((state) =>
              updateWorkspace(state, sourceWorkspaceId, (ws) => ({
                sessions: { ...ws.sessions, [info.id]: info },
                // Pre-initialize messages for child sessions so part updates aren't
                // dropped before fetchMessages completes.
                ...(eventType === "session.created" && !(info.id in ws.messages)
                  ? { messages: { ...ws.messages, [info.id]: [] } }
                  : {}),
              })),
            );
            break;
          }

          case "session.deleted": {
            const info = properties.info as Session;
            if (!info) return;
            sessionSourceWorkspace.delete(info.id);
            set((state) => {
              const ws =
                state.workspaceStates[sourceWorkspaceId] ??
                emptyWorkspaceState();
              const { [info.id]: _s, ...remainingSessions } = ws.sessions;
              const { [info.id]: _m, ...remainingMessages } = ws.messages;
              const { [info.id]: _o, ...remainingOptimistic } =
                ws.optimisticMessageIds;
              const { [info.id]: _st, ...remainingStatuses } =
                ws.sessionStatuses;
              const { [info.id]: _t, ...remainingTodos } = ws.todos;
              const { [info.id]: _a, ...remainingSessionAgents } =
                ws.sessionAgents;
              const { [info.id]: _sm, ...remainingSessionModels } =
                ws.sessionModels;
              const { [info.id]: _sv, ...remainingSessionVariants } =
                ws.sessionVariants;
              const { [info.id]: _lv, ...remainingLastViewedAt } =
                ws.lastViewedAt;

              let nextActiveSessionId = state.activeSessionId;
              if (state.activeSessionId === info.id) {
                const nextSession = Object.values(remainingSessions)
                  .filter((s) => !s.parentID)
                  .sort((a, b) => b.time.updated - a.time.updated)[0];
                nextActiveSessionId = nextSession?.id ?? null;
              }

              return {
                activeSessionId: nextActiveSessionId,
                messageAccessOrder: state.messageAccessOrder.filter(
                  (e) => e.sessionId !== info.id,
                ),
                workspaceStates: {
                  ...state.workspaceStates,
                  [sourceWorkspaceId]: {
                    ...ws,
                    sessions: remainingSessions,
                    messages: remainingMessages,
                    optimisticMessageIds: remainingOptimistic,
                    sessionStatuses: remainingStatuses,
                    todos: remainingTodos,
                    sessionAgents: remainingSessionAgents,
                    sessionModels: remainingSessionModels,
                    sessionVariants: remainingSessionVariants,
                    lastViewedAt: remainingLastViewedAt,
                  },
                },
              };
            });
            break;
          }

          case "session.status": {
            const sessionID = properties.sessionID as string;
            const status = properties.status as SessionStatus;
            const wsId =
              findWorkspaceForSession(get().workspaceStates, sessionID) ??
              sourceWorkspaceId;

            set((state) =>
              updateWorkspace(state, wsId, (ws) => ({
                sessionStatuses: { ...ws.sessionStatuses, [sessionID]: status },
              })),
            );

            // Clear optimistic flag when session status arrives — SSE is now the source of truth
            const { activeSessionId, activeWorkspaceId } = get();
            if (status.type === "idle") {
              // Clear unconditionally when the session goes idle — even if it's a background workspace.
              // The wsId check is kept for the poll (which is active-workspace-only).
              if (get().optimisticStreamingSessionId === sessionID) {
                set({ optimisticStreamingSessionId: null });
              }
              if (wsId === activeWorkspaceId && sessionID === activeSessionId) {
                get().clearStreamingPoll();
              }
            }
            break;
          }

          case "session.idle": {
            const sessionID = properties.sessionID as string;
            const wsId =
              findWorkspaceForSession(get().workspaceStates, sessionID) ??
              sourceWorkspaceId;

            set((state) =>
              updateWorkspace(state, wsId, (ws) => ({
                sessionStatuses: {
                  ...ws.sessionStatuses,
                  [sessionID]: { type: "idle" },
                },
              })),
            );

            const { activeSessionId, activeWorkspaceId } = get();
            // Clear optimistic flag unconditionally when the session goes idle — even for background workspaces.
            if (get().optimisticStreamingSessionId === sessionID) {
              set({ optimisticStreamingSessionId: null });
            }
            if (sessionID === activeSessionId && wsId === activeWorkspaceId) {
              get().clearStreamingPoll();
            }
            playSoundForEvent("agent");
            sendBrowserNotification("Agent completed", {
              body: "The agent has finished processing.",
            });
            break;
          }

          case "session.compacted": {
            const sessionID = properties.sessionID as string;
            const wsId =
              findWorkspaceForSession(get().workspaceStates, sessionID) ??
              sourceWorkspaceId;
            get().fetchMessages(sessionID, wsId);
            break;
          }

          case "session.error": {
            const sessionID = properties.sessionID as string | undefined;
            const errorObj = properties.error as
              | { data?: { message?: string } }
              | undefined;
            const { activeSessionId, activeWorkspaceId } = get();
            if (
              !sessionID ||
              (sessionID === activeSessionId &&
                sourceWorkspaceId === activeWorkspaceId)
            ) {
              get().clearStreamingPoll();
              set({
                optimisticStreamingSessionId: null,
                streamingError: errorObj?.data?.message ?? "Session error",
              });
            }
            playSoundForEvent("errors");
            sendBrowserNotification("Session error", {
              body: errorObj?.data?.message ?? "An error occurred.",
            });
            break;
          }

          case "permission.asked": {
            const permission = properties as unknown as PermissionRequest;
            const wsId =
              findWorkspaceForSession(
                get().workspaceStates,
                permission.sessionID,
              ) ?? sourceWorkspaceId;

            set((state) =>
              updateWorkspace(state, wsId, (ws) => ({
                // Dedup: ignore replayed events from SSE reconnects
                permissions: ws.permissions.some((p) => p.id === permission.id)
                  ? ws.permissions
                  : [...ws.permissions, permission],
              })),
            );
            playSoundForEvent("permissions");
            sendBrowserNotification("Permission required", {
              body: "The agent is waiting for your approval.",
            });
            break;
          }

          case "permission.replied": {
            const requestID = (properties.requestID ??
              properties.permissionID) as string;
            set((state) => {
              const updated: Record<string, WorkspaceState> = {};
              for (const [wsId, ws] of Object.entries(state.workspaceStates)) {
                updated[wsId] = {
                  ...ws,
                  permissions: ws.permissions.filter((p) => p.id !== requestID),
                };
              }
              return { workspaceStates: updated };
            });
            break;
          }

          case "question.asked": {
            const raw = properties as Record<string, unknown>;
            // Validate required fields before storing — malformed payloads crash the UI
            if (
              typeof raw.id !== "string" ||
              typeof raw.sessionID !== "string"
            ) {
              console.warn(
                "[chat] Dropping malformed question.asked event:",
                raw,
              );
              break;
            }
            const question: QuestionRequest = {
              id: raw.id,
              sessionID: raw.sessionID,
              tool: raw.tool as QuestionRequest["tool"],
              // Ensure questions is always a well-formed array — each item must have options as an array
              questions: Array.isArray(raw.questions)
                ? (raw.questions as Record<string, unknown>[]).map((q) => ({
                    question: String(q.question ?? ""),
                    header: String(q.header ?? ""),
                    options: Array.isArray(q.options)
                      ? (q.options as Record<string, unknown>[]).map((o) => ({
                          label: String(o?.label ?? ""),
                          description: String(o?.description ?? ""),
                        }))
                      : [],
                    multiple: q.multiple === true,
                    custom: q.custom !== false,
                  }))
                : [],
            };
            const wsId =
              findWorkspaceForSession(
                get().workspaceStates,
                question.sessionID,
              ) ?? sourceWorkspaceId;

            set((state) =>
              updateWorkspace(state, wsId, (ws) => ({
                // Dedup: ignore replayed events from SSE reconnects
                questions: ws.questions.some((q) => q.id === question.id)
                  ? ws.questions
                  : [...ws.questions, question],
              })),
            );
            break;
          }

          case "question.replied":
          case "question.rejected": {
            // Mirror the permission handler's fallback pattern in case the API renames the field
            const requestID = (properties.requestID ??
              properties.id ??
              properties.questionID) as string;
            if (!requestID) break;
            // Only update the workspace that actually owns this question
            const ownerWsId = Object.entries(get().workspaceStates).find(
              ([, ws]) => ws.questions.some((q) => q.id === requestID),
            )?.[0];
            if (!ownerWsId) break;
            set((state) =>
              updateWorkspace(state, ownerWsId, (ws) => ({
                questions: ws.questions.filter((q) => q.id !== requestID),
              })),
            );
            break;
          }

          case "todo.updated": {
            const todos = properties.todos as Todo[];
            const sessionID = properties.sessionID as string;
            const wsId =
              findWorkspaceForSession(get().workspaceStates, sessionID) ??
              sourceWorkspaceId;

            set((state) =>
              updateWorkspace(state, wsId, (ws) => ({
                todos: { ...ws.todos, [sessionID]: todos },
              })),
            );
            break;
          }
        }
      },

      startStreamingPoll: (workspaceId) => {
        get().clearStreamingPoll();
        const interval = setInterval(() => {
          const status = get().getStreamingStatus();
          if (status === "idle") {
            get().clearStreamingPoll();
            return;
          }
          get().refreshActiveSessionStatus(workspaceId);
        }, 4000);
        set({ streamingPollInterval: interval });
      },

      clearStreamingPoll: () => {
        const interval = get().streamingPollInterval;
        if (interval) {
          clearInterval(interval);
          set({ streamingPollInterval: null });
        }
      },

      clearChat: () => {
        get().clearStreamingPoll();
        set({
          activeSessionId: null,
          optimisticStreamingSessionId: null,
          streamingError: null,
        });
      },

      // Selectors

      getStreamingStatus: (): StreamingStatus => {
        const {
          activeWorkspaceId,
          activeSessionId,
          workspaceStates,
          optimisticStreamingSessionId,
          streamingError,
        } = get();

        // Error state takes priority — cleared explicitly when user dismisses or SSE reconnects
        if (streamingError) return "error";

        if (!activeWorkspaceId || !activeSessionId) return "idle";

        const ws = workspaceStates[activeWorkspaceId];
        if (!ws) return "idle";

        // Pending question or permission for this session → waiting for user input
        if (ws.questions.some((q) => q.sessionID === activeSessionId))
          return "waiting";
        if (ws.permissions.some((p) => p.sessionID === activeSessionId))
          return "waiting";

        // SSE-confirmed non-idle session status → streaming
        const sessionStatus = ws.sessionStatuses[activeSessionId];
        if (sessionStatus && sessionStatus.type !== "idle") return "streaming";

        // Optimistic: sendMessage fired but first SSE hasn't arrived yet
        if (optimisticStreamingSessionId === activeSessionId)
          return "streaming";

        return "idle";
      },

      getWorkspaceActivity: (workspaceId) => {
        const ws = get().workspaceStates[workspaceId];
        if (!ws) return "idle";
        if (ws.permissions.length > 0 || ws.questions.length > 0)
          return "waiting";
        const statuses = Object.values(ws.sessionStatuses);
        if (statuses.some((s) => s.type !== "idle")) return "active";
        return "idle";
      },

      getActiveWorkspaceSessions: () => {
        const { activeWorkspaceId, workspaceStates } = get();
        if (!activeWorkspaceId) return EMPTY_SESSIONS;
        return workspaceStates[activeWorkspaceId]?.sessions ?? EMPTY_SESSIONS;
      },

      getActiveSessionMessages: () => {
        const { activeSessionId, activeWorkspaceId, workspaceStates } = get();
        if (!activeSessionId || !activeWorkspaceId) return EMPTY_MESSAGES;
        return (
          workspaceStates[activeWorkspaceId]?.messages[activeSessionId] ??
          EMPTY_MESSAGES
        );
      },

      getActiveSessionStatus: () => {
        const { activeSessionId, activeWorkspaceId, workspaceStates } = get();
        if (!activeSessionId || !activeWorkspaceId) return null;
        return (
          workspaceStates[activeWorkspaceId]?.sessionStatuses[
            activeSessionId
          ] ?? null
        );
      },

      getActivePermissions: () => {
        const { activeWorkspaceId, workspaceStates } = get();
        if (!activeWorkspaceId) return EMPTY_PERMISSIONS;
        const ws = workspaceStates[activeWorkspaceId];
        if (!ws) return EMPTY_PERMISSIONS;
        // Return the raw array — stable reference that only changes when permissions
        // are actually added/removed. Callers must filter by sessionID themselves.
        // Do NOT call .filter() here: it always returns a new reference, which causes
        // useSyncExternalStore to see a changed snapshot every tick → infinite re-render.
        return ws.permissions.length > 0 ? ws.permissions : EMPTY_PERMISSIONS;
      },

      getActiveQuestions: () => {
        const { activeWorkspaceId, workspaceStates } = get();
        if (!activeWorkspaceId) return EMPTY_QUESTIONS;
        const ws = workspaceStates[activeWorkspaceId];
        if (!ws) return EMPTY_QUESTIONS;
        // Return the raw array — stable reference that only changes when questions
        // are actually added/removed. Callers must filter by sessionID themselves.
        // Do NOT call .filter() here: it always returns a new reference, which causes
        // useSyncExternalStore to see a changed snapshot every tick → infinite re-render.
        return ws.questions.length > 0 ? ws.questions : EMPTY_QUESTIONS;
      },

      getActiveSessionStatuses: () => {
        const { activeWorkspaceId, workspaceStates } = get();
        if (!activeWorkspaceId) return EMPTY_SESSION_STATUSES;
        return (
          workspaceStates[activeWorkspaceId]?.sessionStatuses ??
          EMPTY_SESSION_STATUSES
        );
      },

      getActiveTodos: () => {
        const { activeSessionId, activeWorkspaceId, workspaceStates } = get();
        if (!activeSessionId || !activeWorkspaceId) return EMPTY_TODOS;
        return (
          workspaceStates[activeWorkspaceId]?.todos[activeSessionId] ??
          EMPTY_TODOS
        );
      },

      getRecentSessionsAcrossWorkspaces: (limit) => {
        const { workspaceStates } = get();
        const entries = Object.entries(workspaceStates);

        if (entries.length === 0) return EMPTY_UNIFIED_SESSIONS;

        const refsUnchanged =
          limit === _unifiedSessionsCacheLimit &&
          entries.length === _unifiedSessionsCacheRefs.size &&
          entries.every(
            ([id, ws]) => _unifiedSessionsCacheRefs.get(id) === ws.sessions,
          );

        // Exact cache hit — refs unchanged
        if (refsUnchanged) {
          return _unifiedSessionsCache;
        }

        // During rapid SSE bursts (streaming), return stale cache for up to 500ms
        const now = Date.now();
        if (
          _unifiedSessionsCache !== EMPTY_UNIFIED_SESSIONS &&
          now - _unifiedSessionsCacheTime < 500
        ) {
          return _unifiedSessionsCache;
        }

        const result: SessionWithWorkspace[] = [];
        const newRefs = new Map<string, Record<string, Session>>();
        for (const [workspaceId, ws] of entries) {
          newRefs.set(workspaceId, ws.sessions);
          for (const session of Object.values(ws.sessions)) {
            if (!session.parentID) {
              result.push({ ...session, workspaceId });
            }
          }
        }

        _unifiedSessionsCache = result
          .sort((a, b) => b.time.updated - a.time.updated)
          .slice(0, limit);
        _unifiedSessionsCacheRefs = newRefs;
        _unifiedSessionsCacheLimit = limit;
        _unifiedSessionsCacheTime = now;
        return _unifiedSessionsCache;
      },

      getUnifiedSessionStatuses: () => {
        const { workspaceStates } = get();
        const entries = Object.entries(workspaceStates);

        if (entries.length === 0) return EMPTY_SESSION_STATUSES;

        if (
          entries.length === _unifiedStatusesCacheRefs.size &&
          entries.every(
            ([id, ws]) =>
              _unifiedStatusesCacheRefs.get(id) === ws.sessionStatuses,
          )
        ) {
          return _unifiedStatusesCache;
        }

        const merged: Record<string, SessionStatus> = {};
        const newRefs = new Map<string, Record<string, SessionStatus>>();
        for (const [wsId, ws] of entries) {
          newRefs.set(wsId, ws.sessionStatuses);
          Object.assign(merged, ws.sessionStatuses);
        }

        _unifiedStatusesCache = merged;
        _unifiedStatusesCacheRefs = newRefs;
        return _unifiedStatusesCache;
      },

      getActiveQuestionSessionIds: () => {
        const { activeWorkspaceId, workspaceStates } = get();
        if (!activeWorkspaceId) return EMPTY_QUESTION_SESSION_IDS;
        const ws = workspaceStates[activeWorkspaceId];
        if (!ws) return EMPTY_QUESTION_SESSION_IDS;
        const questions = ws.questions;
        if (questions === _activeQuestionSessionIdsCacheRef)
          return _activeQuestionSessionIdsCache;
        _activeQuestionSessionIdsCacheRef = questions;
        if (questions.length === 0) {
          _activeQuestionSessionIdsCache = EMPTY_QUESTION_SESSION_IDS;
          return _activeQuestionSessionIdsCache;
        }
        const ids = new Set<string>();
        for (const q of questions) ids.add(q.sessionID);
        _activeQuestionSessionIdsCache = ids;
        return _activeQuestionSessionIdsCache;
      },

      getUnifiedQuestionSessionIds: () => {
        const { workspaceStates } = get();
        const entries = Object.entries(workspaceStates);

        if (entries.length === 0) return EMPTY_QUESTION_SESSION_IDS;

        if (
          entries.length === _unifiedQuestionSessionIdsCacheRefs.size &&
          entries.every(
            ([id, ws]) =>
              _unifiedQuestionSessionIdsCacheRefs.get(id) === ws.questions,
          )
        ) {
          return _unifiedQuestionSessionIdsCache;
        }

        const merged = new Set<string>();
        const newRefs = new Map<string, QuestionRequest[]>();
        for (const [wsId, ws] of entries) {
          newRefs.set(wsId, ws.questions);
          for (const q of ws.questions) merged.add(q.sessionID);
        }

        _unifiedQuestionSessionIdsCache =
          merged.size > 0 ? merged : EMPTY_QUESTION_SESSION_IDS;
        _unifiedQuestionSessionIdsCacheRefs = newRefs;
        return _unifiedQuestionSessionIdsCache;
      },

      getUnifiedLastViewedAt: () => {
        const { workspaceStates } = get();
        const entries = Object.entries(workspaceStates);

        if (entries.length === 0) return EMPTY_LAST_VIEWED;

        if (
          entries.length === _unifiedLastViewedCacheRefs.size &&
          entries.every(
            ([id, ws]) =>
              _unifiedLastViewedCacheRefs.get(id) === ws.lastViewedAt,
          )
        ) {
          return _unifiedLastViewedCache;
        }

        const merged: Record<string, number> = {};
        const newRefs = new Map<string, Record<string, number>>();
        for (const [wsId, ws] of entries) {
          newRefs.set(wsId, ws.lastViewedAt);
          Object.assign(merged, ws.lastViewedAt);
        }

        _unifiedLastViewedCache = merged;
        _unifiedLastViewedCacheRefs = newRefs;
        return _unifiedLastViewedCache;
      },

      getUnifiedPinnedSessionIds: () => {
        const { workspaceStates } = get();
        const entries = Object.entries(workspaceStates);

        if (entries.length === 0) return EMPTY_PINNED;

        if (
          entries.length === _unifiedPinnedCacheRefs.size &&
          entries.every(
            ([id, ws]) =>
              _unifiedPinnedCacheRefs.get(id) === ws.pinnedSessionIds,
          )
        ) {
          return _unifiedPinnedCache;
        }

        const merged = new Set<string>();
        const newRefs = new Map<string, Set<string>>();
        for (const [wsId, ws] of entries) {
          newRefs.set(wsId, ws.pinnedSessionIds);
          for (const id of ws.pinnedSessionIds) merged.add(id);
        }

        _unifiedPinnedCache = merged.size > 0 ? merged : EMPTY_PINNED;
        _unifiedPinnedCacheRefs = newRefs;
        return _unifiedPinnedCache;
      },

      getActivePinnedSessionIds: () => {
        const { activeWorkspaceId, workspaceStates } = get();
        if (!activeWorkspaceId) return EMPTY_PINNED;
        const pins = workspaceStates[activeWorkspaceId]?.pinnedSessionIds;
        return pins && pins.size > 0 ? pins : EMPTY_PINNED;
      },

      setSessionAgent: (sessionId, workspaceId, agent) => {
        set((state) =>
          updateWorkspace(state, workspaceId, (ws) => ({
            sessionAgents: { ...ws.sessionAgents, [sessionId]: agent },
          })),
        );
      },

      getSessionAgent: (sessionId) => {
        const { activeWorkspaceId, workspaceStates } = get();
        const wsId =
          activeWorkspaceId ??
          findWorkspaceForSession(workspaceStates, sessionId);
        if (!wsId) return null;
        return workspaceStates[wsId]?.sessionAgents[sessionId] ?? null;
      },

      setSessionModel: (sessionId, workspaceId, model) => {
        set((state) =>
          updateWorkspace(state, workspaceId, (ws) => ({
            sessionModels: { ...ws.sessionModels, [sessionId]: model },
          })),
        );
      },

      clearSessionModel: (sessionId, workspaceId) => {
        set((state) =>
          updateWorkspace(state, workspaceId, (ws) => {
            const { [sessionId]: _, ...remaining } = ws.sessionModels;
            return { sessionModels: remaining };
          }),
        );
      },

      getSessionModel: (sessionId) => {
        const { activeWorkspaceId, workspaceStates } = get();
        const wsId =
          activeWorkspaceId ??
          findWorkspaceForSession(workspaceStates, sessionId);
        if (!wsId) return null;
        return workspaceStates[wsId]?.sessionModels[sessionId] ?? null;
      },

      setSessionVariant: (sessionId, workspaceId, variant) => {
        set((state) =>
          updateWorkspace(state, workspaceId, (ws) => ({
            sessionVariants: { ...ws.sessionVariants, [sessionId]: variant },
          })),
        );
      },

      clearSessionVariant: (sessionId, workspaceId) => {
        set((state) =>
          updateWorkspace(state, workspaceId, (ws) => {
            const { [sessionId]: _, ...remaining } = ws.sessionVariants;
            return { sessionVariants: remaining };
          }),
        );
      },

      getSessionVariant: (sessionId) => {
        const { activeWorkspaceId, workspaceStates } = get();
        const wsId =
          activeWorkspaceId ??
          findWorkspaceForSession(workspaceStates, sessionId);
        if (!wsId) return null;
        return workspaceStates[wsId]?.sessionVariants[sessionId] ?? null;
      },

      fetchCachedSessions: async (workspaceId) => {
        try {
          const response = await fetch(
            `/api/sessions/cache?workspaceId=${workspaceId}`,
          );
          if (!response.ok) {
            set((state) => {
              if (state.workspaceStates[workspaceId]?.sessionsLoaded)
                return state;
              return updateWorkspace(state, workspaceId, () => ({
                sessionsLoaded: true,
              }));
            });
            return;
          }
          const data = await response.json();
          if (!Array.isArray(data) || data.length === 0) {
            set((state) => {
              if (state.workspaceStates[workspaceId]?.sessionsLoaded)
                return state;
              return updateWorkspace(state, workspaceId, () => ({
                sessionsLoaded: true,
              }));
            });
            return;
          }
          const sessionsMap: Record<string, Session> = {};
          for (const session of data) {
            sessionsMap[session.id] = session;
          }
          set((state) => {
            const ws = state.workspaceStates[workspaceId];
            if (ws && Object.keys(ws.sessions).length > 0) return state;
            return updateWorkspace(state, workspaceId, () => ({
              sessions: sessionsMap,
              sessionsLoaded: true,
            }));
          });
        } catch {
          set((state) => {
            if (state.workspaceStates[workspaceId]?.sessionsLoaded)
              return state;
            return updateWorkspace(state, workspaceId, () => ({
              sessionsLoaded: true,
            }));
          });
        }
      },

      fetchPinnedSessions: async (workspaceId) => {
        try {
          const response = await fetch(
            `/api/workspaces/${workspaceId}/pinned-sessions`,
          );
          if (!response.ok) return;
          const sessionIds: string[] = await response.json();
          set((state) =>
            updateWorkspace(state, workspaceId, () => ({
              pinnedSessionIds: new Set(sessionIds),
            })),
          );
        } catch {
          // Best effort
        }
      },

      pinSession: async (sessionId, workspaceId) => {
        set((state) =>
          updateWorkspace(state, workspaceId, (ws) => ({
            pinnedSessionIds: new Set([...ws.pinnedSessionIds, sessionId]),
          })),
        );
        try {
          await fetch(`/api/workspaces/${workspaceId}/pinned-sessions`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ sessionId }),
          });
        } catch {
          set((state) =>
            updateWorkspace(state, workspaceId, (ws) => {
              const next = new Set(ws.pinnedSessionIds);
              next.delete(sessionId);
              return { pinnedSessionIds: next };
            }),
          );
        }
      },

      unpinSession: async (sessionId, workspaceId) => {
        const previousPinned =
          get().workspaceStates[workspaceId]?.pinnedSessionIds;
        set((state) =>
          updateWorkspace(state, workspaceId, (ws) => {
            const next = new Set(ws.pinnedSessionIds);
            next.delete(sessionId);
            return { pinnedSessionIds: next };
          }),
        );
        try {
          await fetch(
            `/api/workspaces/${workspaceId}/pinned-sessions?sessionId=${sessionId}`,
            {
              method: "DELETE",
            },
          );
        } catch {
          if (previousPinned) {
            set((state) =>
              updateWorkspace(state, workspaceId, () => ({
                pinnedSessionIds: previousPinned,
              })),
            );
          }
        }
      },

      isSessionPinned: (sessionId, workspaceId) => {
        return (
          get().workspaceStates[workspaceId]?.pinnedSessionIds.has(sessionId) ??
          false
        );
      },

      getPinnedSessionIds: (workspaceId) => {
        return (
          get().workspaceStates[workspaceId]?.pinnedSessionIds ?? EMPTY_PINNED
        );
      },

      fetchSessionNotes: async (workspaceId) => {
        try {
          const response = await fetch(
            `/api/workspaces/${workspaceId}/session-notes`,
          );
          if (!response.ok) return;
          const notes: Record<string, string> = await response.json();
          set((state) =>
            updateWorkspace(state, workspaceId, () => ({
              sessionNotes: notes,
            })),
          );
        } catch {
          // Best effort
        }
      },

      setSessionNote: async (sessionId, workspaceId, note) => {
        set((state) =>
          updateWorkspace(state, workspaceId, (ws) => ({
            sessionNotes: { ...ws.sessionNotes, [sessionId]: note },
          })),
        );
        try {
          await fetch(`/api/workspaces/${workspaceId}/session-notes`, {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ sessionId, note }),
          });
        } catch {
          set((state) =>
            updateWorkspace(state, workspaceId, (ws) => {
              const { [sessionId]: _, ...remaining } = ws.sessionNotes;
              return { sessionNotes: remaining };
            }),
          );
        }
      },

      clearSessionNote: async (sessionId, workspaceId) => {
        const previousNotes = get().workspaceStates[workspaceId]?.sessionNotes;
        set((state) =>
          updateWorkspace(state, workspaceId, (ws) => {
            const { [sessionId]: _, ...remaining } = ws.sessionNotes;
            return { sessionNotes: remaining };
          }),
        );
        try {
          await fetch(
            `/api/workspaces/${workspaceId}/session-notes?sessionId=${sessionId}`,
            { method: "DELETE" },
          );
        } catch {
          if (previousNotes) {
            set((state) =>
              updateWorkspace(state, workspaceId, () => ({
                sessionNotes: previousNotes,
              })),
            );
          }
        }
      },

      getActiveSessionNotes: () => {
        const { activeWorkspaceId, workspaceStates } = get();
        if (!activeWorkspaceId) return EMPTY_SESSION_NOTES;
        const notes = workspaceStates[activeWorkspaceId]?.sessionNotes;
        return notes && Object.keys(notes).length > 0
          ? notes
          : EMPTY_SESSION_NOTES;
      },

      getUnifiedSessionNotes: () => {
        const { workspaceStates } = get();
        const entries = Object.entries(workspaceStates);

        if (entries.length === 0) return EMPTY_SESSION_NOTES;

        if (
          entries.length === _unifiedSessionNotesCacheRefs.size &&
          entries.every(
            ([id, ws]) =>
              _unifiedSessionNotesCacheRefs.get(id) === ws.sessionNotes,
          )
        ) {
          return _unifiedSessionNotesCache;
        }

        const merged: Record<string, string> = {};
        const newRefs = new Map<string, Record<string, string>>();
        for (const [wsId, ws] of entries) {
          newRefs.set(wsId, ws.sessionNotes);
          Object.assign(merged, ws.sessionNotes);
        }

        _unifiedSessionNotesCache =
          Object.keys(merged).length > 0 ? merged : EMPTY_SESSION_NOTES;
        _unifiedSessionNotesCacheRefs = newRefs;
        return _unifiedSessionNotesCache;
      },
    }),
    {
      name: "dev-hub-chat",
      partialize: (state): PersistedChatState => {
        const wsStates: PersistedChatState["workspaceStates"] = {};
        for (const [wsId, ws] of Object.entries(state.workspaceStates)) {
          wsStates[wsId] = {
            sessionAgents: ws.sessionAgents,
            sessionModels: ws.sessionModels,
            sessionVariants: ws.sessionVariants,
            lastViewedAt: ws.lastViewedAt,
          };
        }
        return {
          activeSessionId: state.activeSessionId,
          workspaceStates: wsStates,
        };
      },
      merge: (persisted, current) => {
        const p = persisted as PersistedChatState | undefined;
        if (!p) return current;
        const merged = { ...current };
        if (p.activeSessionId) {
          merged.activeSessionId = p.activeSessionId;
        }
        if (p.workspaceStates) {
          const nextWs = { ...merged.workspaceStates };
          for (const [wsId, pws] of Object.entries(p.workspaceStates)) {
            const existing = nextWs[wsId] ?? emptyWorkspaceState();
            nextWs[wsId] = {
              ...existing,
              sessionAgents: {
                ...existing.sessionAgents,
                ...pws.sessionAgents,
              },
              sessionModels: {
                ...existing.sessionModels,
                ...pws.sessionModels,
              },
              sessionVariants: {
                ...existing.sessionVariants,
                ...pws.sessionVariants,
              },
              lastViewedAt: { ...existing.lastViewedAt, ...pws.lastViewedAt },
            };
          }
          merged.workspaceStates = nextWs;
        }
        return merged;
      },
    },
  ),
);
