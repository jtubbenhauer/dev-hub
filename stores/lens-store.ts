"use client";

import { create } from "zustand";
import type {
  Session,
  Message,
  Part,
  MessageWithParts,
} from "@/lib/opencode/types";

export type LensStatus = "uninitialized" | "initializing" | "ready" | "error";

export type StreamingStatus = "idle" | "streaming" | "error";

interface LensState {
  status: LensStatus;
  sessionId: string | null;
  messages: MessageWithParts[];
  streamingStatus: StreamingStatus;
  streamingError: string | null;
  eventSource: EventSource | null;
  reconnectAttempts: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;

  initialize: () => Promise<void>;
  sendMessage: (text: string) => Promise<void>;
  fetchMessages: () => Promise<void>;
  connectSSE: () => void;
  disconnectSSE: () => void;
  handleEvent: (event: Record<string, unknown>) => void;
  reset: () => void;
}

const EMPTY_MESSAGES: MessageWithParts[] = [];
const MAX_RECONNECT_ATTEMPTS = 20;

// RAF-batched buffers for high-frequency SSE events.
// message.updated and message.part.updated fire at 10-50 Hz during streaming;
// buffering them prevents useSyncExternalStore from exceeding React's update depth limit.
const pendingMessageUpdates = new Map<string, Message>();
const pendingPartUpdates = new Map<string, Map<string, Part>>();
let flushScheduled = false;
let flushHandle: number | null = null;

type SetFn = (fn: (state: LensState) => Partial<LensState>) => void;

function flushPendingUpdates(set: SetFn): void {
  if (pendingMessageUpdates.size === 0 && pendingPartUpdates.size === 0) return;

  const messageSnapshot = new Map(pendingMessageUpdates);
  const partSnapshot = new Map(
    [...pendingPartUpdates.entries()].map(
      ([msgId, byPart]) => [msgId, new Map(byPart)] as const,
    ),
  );
  pendingMessageUpdates.clear();
  pendingPartUpdates.clear();

  set((state) => {
    let messages = state.messages;

    // Apply buffered message.updated events
    for (const [messageId, info] of messageSnapshot) {
      const existingIndex = messages.findIndex((m) => m.info.id === messageId);
      if (existingIndex >= 0) {
        messages = messages === state.messages ? [...messages] : messages;
        messages[existingIndex] = { ...messages[existingIndex], info };
      } else {
        messages = messages === state.messages ? [...messages] : messages;
        messages.push({ info, parts: [] });
      }
    }

    // Apply buffered message.part.updated events
    for (const [messageId, byPart] of partSnapshot) {
      const messageIndex = messages.findIndex((m) => m.info.id === messageId);
      if (messageIndex < 0) continue;

      messages = messages === state.messages ? [...messages] : messages;
      const message = messages[messageIndex];
      let updatedParts = message.parts;

      for (const [partId, part] of byPart) {
        const partIndex = updatedParts.findIndex((p) => p.id === partId);
        updatedParts =
          partIndex >= 0
            ? updatedParts.map((p, i) => (i === partIndex ? part : p))
            : [...updatedParts, part];
      }

      messages[messageIndex] = { ...message, parts: updatedParts };
    }

    if (messages === state.messages) return state;
    return { messages };
  });
}

function scheduleFlush(set: SetFn): void {
  if (flushScheduled) return;
  flushScheduled = true;

  if (typeof document !== "undefined" && document.hidden) {
    flushHandle = window.setTimeout(() => {
      flushScheduled = false;
      flushHandle = null;
      flushPendingUpdates(set);
    }, 500) as unknown as number;
  } else {
    flushHandle = requestAnimationFrame(() => {
      flushScheduled = false;
      flushHandle = null;
      flushPendingUpdates(set);
    }) as unknown as number;
  }
}

export function _resetModuleCaches(): void {
  pendingMessageUpdates.clear();
  pendingPartUpdates.clear();
  flushScheduled = false;
  if (flushHandle !== null) {
    cancelAnimationFrame(flushHandle);
    flushHandle = null;
  }
}

export const useLensStore = create<LensState>()((set, get) => ({
  status: "uninitialized",
  sessionId: null,
  messages: EMPTY_MESSAGES,
  streamingStatus: "idle",
  streamingError: null,
  eventSource: null,
  reconnectAttempts: 0,
  reconnectTimer: null,

  initialize: async () => {
    const { status } = get();
    if (status === "initializing" || status === "ready") return;

    set({ status: "initializing" });

    try {
      const getResponse = await fetch("/api/lens/session");
      if (!getResponse.ok) {
        throw new Error(`Session GET failed: ${getResponse.status}`);
      }

      let session: Session | null = await getResponse.json();

      if (!session) {
        const postResponse = await fetch("/api/lens/session", {
          method: "POST",
        });
        if (!postResponse.ok) {
          throw new Error(`Session POST failed: ${postResponse.status}`);
        }
        session = (await postResponse.json()) as Session;
      }

      set({ sessionId: session.id, status: "ready" });
      get().fetchMessages();
      get().connectSSE();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to initialize";
      console.error("[lens] Initialize failed:", message);
      set({ status: "error", streamingError: message });
    }
  },

  sendMessage: async (text) => {
    const { sessionId, status } = get();
    if (!sessionId || status !== "ready") return;

    set({ streamingStatus: "streaming", streamingError: null });

    try {
      const response = await fetch("/api/lens/prompt", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, text }),
      });

      if (!response.ok && response.status !== 204) {
        const body = await response.text();
        throw new Error(`Prompt failed (${response.status}): ${body}`);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to send message";
      console.error("[lens] Send failed:", message);
      set({ streamingStatus: "error", streamingError: message });
    }
  },

  fetchMessages: async () => {
    const { sessionId } = get();
    if (!sessionId) return;

    try {
      const response = await fetch(`/api/lens/messages?sessionId=${sessionId}`);
      if (!response.ok) return;

      const data: MessageWithParts[] = await response.json();
      set({ messages: data.length > 0 ? data : EMPTY_MESSAGES });
    } catch {
      // Best effort — SSE will update messages in real-time
    }
  },

  connectSSE: () => {
    const existing = get().eventSource;
    if (existing && existing.readyState !== EventSource.CLOSED) {
      return;
    }

    const pendingTimer = get().reconnectTimer;
    if (pendingTimer !== null) {
      clearTimeout(pendingTimer);
      set({ reconnectTimer: null });
    }

    const eventSource = new EventSource("/api/lens/events");

    eventSource.onopen = () => {
      set({ reconnectAttempts: 0 });
      get().fetchMessages();
    };

    eventSource.onmessage = (evt) => {
      try {
        const event = JSON.parse(evt.data) as Record<string, unknown>;
        get().handleEvent(event);
      } catch {
        // Ignore malformed events
      }
    };

    eventSource.onerror = () => {
      eventSource.close();

      const attempts = get().reconnectAttempts;
      const backoffMs = Math.min(1000 * 2 ** Math.min(attempts, 5), 30_000);

      if (attempts >= MAX_RECONNECT_ATTEMPTS) {
        console.warn("[lens] SSE reconnect limit reached");
        set({ eventSource: null });
        return;
      }

      set({ reconnectAttempts: attempts + 1, eventSource: null });

      const timer = setTimeout(() => {
        set({ reconnectTimer: null });
        if (!get().eventSource) {
          get().connectSSE();
        }
      }, backoffMs);
      set({ reconnectTimer: timer });
    };

    set({ eventSource });
  },

  disconnectSSE: () => {
    const { eventSource, reconnectTimer } = get();
    if (eventSource) {
      eventSource.close();
    }
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
    }
    set({
      eventSource: null,
      reconnectAttempts: 0,
      reconnectTimer: null,
    });
  },

  handleEvent: (event) => {
    const { sessionId } = get();
    if (!sessionId) return;

    const eventType = event.type as string;
    const properties = event.properties as Record<string, unknown> | undefined;

    if (!properties) return;

    switch (eventType) {
      case "message.updated": {
        const info = properties.info as Message;
        if (!info || info.sessionID !== sessionId) return;

        pendingMessageUpdates.set(info.id, info);
        scheduleFlush(set);
        break;
      }

      case "message.part.updated": {
        const part = properties.part as Part;
        if (!part || part.sessionID !== sessionId) return;

        let byPart = pendingPartUpdates.get(part.messageID);
        if (!byPart) {
          byPart = new Map();
          pendingPartUpdates.set(part.messageID, byPart);
        }
        byPart.set(part.id, part);
        scheduleFlush(set);
        break;
      }

      case "message.part.removed": {
        const partSessionID = properties.sessionID as string;
        const messageID = properties.messageID as string;
        const partID = properties.partID as string;
        if (partSessionID !== sessionId) return;

        set((state) => ({
          messages: state.messages.map((m) =>
            m.info.id === messageID
              ? { ...m, parts: m.parts.filter((p) => p.id !== partID) }
              : m,
          ),
        }));
        break;
      }

      case "message.removed": {
        const removedSessionID = properties.sessionID as string;
        const messageID = properties.messageID as string;
        if (removedSessionID !== sessionId) return;

        set((state) => ({
          messages: state.messages.filter((m) => m.info.id !== messageID),
        }));
        break;
      }

      case "session.status": {
        const statusSessionID = properties.sessionID as string;
        const status = properties.status as { type: string };
        if (statusSessionID !== sessionId) return;

        if (status.type === "idle") {
          set({ streamingStatus: "idle" });
        } else if (status.type !== "idle") {
          set({ streamingStatus: "streaming" });
        }
        break;
      }

      case "session.idle": {
        const idleSessionID = properties.sessionID as string;
        if (idleSessionID !== sessionId) return;

        set({ streamingStatus: "idle" });
        break;
      }

      case "session.error": {
        const errorSessionID = properties.sessionID as string | undefined;
        if (errorSessionID && errorSessionID !== sessionId) return;

        const errorObj = properties.error as
          | { data?: { message?: string } }
          | undefined;
        set({
          streamingStatus: "error",
          streamingError: errorObj?.data?.message ?? "Session error",
        });
        break;
      }

      case "session.compacted": {
        const compactedSessionID = properties.sessionID as string;
        if (compactedSessionID !== sessionId) return;

        get().fetchMessages();
        break;
      }
    }
  },

  reset: () => {
    get().disconnectSSE();
    _resetModuleCaches();
    set({
      status: "uninitialized",
      sessionId: null,
      messages: EMPTY_MESSAGES,
      streamingStatus: "idle",
      streamingError: null,
    });
  },
}));
