import { create } from "zustand";
import type { ActiveProcess } from "@/lib/commands/types";

interface CommandSession {
  sessionId: string;
  command: string;
  workspaceId: string;
  lines: string[];
  isRunning: boolean;
  exitCode: number | null;
  abortController: AbortController | null;
}

interface CommandState {
  sessions: Record<string, CommandSession>;
  activeSessionId: string | null;
  isDrawerOpen: boolean;

  setDrawerOpen: (open: boolean) => void;
  setActiveSessionId: (id: string | null) => void;

  runCommand: (command: string, workspaceId: string) => string;
  killCommand: (sessionId: string) => Promise<void>;
  removeSession: (sessionId: string) => void;
  fetchActiveProcesses: () => Promise<void>;
  reconnectToProcess: (process: ActiveProcess) => void;
}

export const useCommandStore = create<CommandState>()((set, get) => ({
  sessions: {},
  activeSessionId: null,
  isDrawerOpen: false,

  setDrawerOpen: (open) => set({ isDrawerOpen: open }),
  setActiveSessionId: (id) => set({ activeSessionId: id }),

  runCommand: (command, workspaceId) => {
    const abortController = new AbortController();
    const sessionId = crypto.randomUUID();

    const session: CommandSession = {
      sessionId,
      command,
      workspaceId,
      lines: [],
      isRunning: true,
      exitCode: null,
      abortController,
    };

    set((state) => ({
      sessions: { ...state.sessions, [sessionId]: session },
      activeSessionId: sessionId,
    }));

    streamFromServer(
      sessionId,
      command,
      workspaceId,
      abortController,
      set,
      get,
    );

    return sessionId;
  },

  killCommand: async (sessionId) => {
    const session = get().sessions[sessionId];
    try {
      await fetch("/api/commands/kill", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, workspaceId: session?.workspaceId }),
      });
    } catch {
      // Best effort
    }

    // Always provide immediate UI feedback after kill.
    // The SSE stream may also deliver an exit event, but markExited is
    // idempotent so the duplicate is harmless.
    const currentSession = get().sessions[sessionId];
    if (currentSession && currentSession.isRunning) {
      appendLines(set, sessionId, "\x1b[90m\n--- process killed ---\x1b[0m\n");
      markExited(set, sessionId, null);
    }
  },

  removeSession: (sessionId) => {
    const session = get().sessions[sessionId];
    session?.abortController?.abort();

    // Drop any buffered lines so they don't flush after removal
    pendingLines.delete(sessionId);

    set((state) => {
      const { [sessionId]: _, ...remaining } = state.sessions;
      return {
        sessions: remaining,
        activeSessionId:
          state.activeSessionId === sessionId ? null : state.activeSessionId,
      };
    });

    // Best-effort cleanup on the server so it doesn't resurrect on next drawer open
    fetch(`/api/commands/${sessionId}`, { method: "DELETE" }).catch(() => {});
  },

  fetchActiveProcesses: async () => {
    try {
      const res = await fetch("/api/commands/active");
      if (!res.ok) return;

      const { processes } = (await res.json()) as {
        processes: ActiveProcess[];
      };
      const currentSessions = get().sessions;

      for (const proc of processes) {
        if (currentSessions[proc.sessionId]) continue;

        if (proc.exited) {
          // Add as a finished session — no reconnect, no stream
          set((state) => ({
            sessions: {
              ...state.sessions,
              [proc.sessionId]: {
                sessionId: proc.sessionId,
                command: proc.command,
                workspaceId: proc.workspaceId,
                lines: [
                  "\x1b[90m(output not available — process already exited)\x1b[0m\n",
                ],
                isRunning: false,
                exitCode: proc.exitCode,
                abortController: null,
              },
            },
          }));
        } else {
          get().reconnectToProcess(proc);
        }
      }
    } catch {
      // Best effort
    }
  },

  reconnectToProcess: (proc) => {
    // Process is running server-side but we have no SSE stream to it.
    // Show it as running with a note — the user can kill or close it.
    set((state) => ({
      sessions: {
        ...state.sessions,
        [proc.sessionId]: {
          sessionId: proc.sessionId,
          command: proc.command,
          workspaceId: proc.workspaceId,
          lines: [
            "\x1b[90m(process running in background — output not available)\x1b[0m\n",
          ],
          isRunning: true,
          exitCode: null,
          abortController: null,
        },
      },
    }));
  },
}));

// Pending lines waiting to be flushed to the store, keyed by sessionId.
// Using a module-level Map so it's shared across all store instances.
const pendingLines = new Map<string, string[]>();
let flushHandle: number | null = null;

function doFlush(
  set: (updater: (state: CommandState) => Partial<CommandState>) => void,
) {
  flushHandle = null;
  if (pendingLines.size === 0) return;

  const snapshot = new Map(pendingLines);
  pendingLines.clear();

  set((state) => {
    const updatedSessions = { ...state.sessions };
    for (const [sessionId, newLines] of snapshot) {
      const session = updatedSessions[sessionId];
      if (!session) continue;
      updatedSessions[sessionId] = {
        ...session,
        lines: [...session.lines, ...newLines],
      };
    }
    return { sessions: updatedSessions };
  });
}

function scheduleFlush(
  set: (updater: (state: CommandState) => Partial<CommandState>) => void,
) {
  if (flushHandle !== null) return;

  // When the tab is hidden, RAF is suspended by the browser. Fall back to a
  // short timeout so output lines still land in the store while backgrounded.
  if (typeof document !== "undefined" && document.hidden) {
    flushHandle = window.setTimeout(
      () => doFlush(set),
      500,
    ) as unknown as number;
  } else {
    flushHandle = requestAnimationFrame(() => doFlush(set));
  }
}

function appendLines(
  set: (updater: (state: CommandState) => Partial<CommandState>) => void,
  sessionId: string,
  data: string,
) {
  const buffer = pendingLines.get(sessionId);
  if (buffer) {
    buffer.push(data);
  } else {
    pendingLines.set(sessionId, [data]);
  }
  scheduleFlush(set);
}

function markExited(
  set: (updater: (state: CommandState) => Partial<CommandState>) => void,
  sessionId: string,
  exitCode: number | null,
) {
  set((state) => {
    const session = state.sessions[sessionId];
    if (!session) return state;
    return {
      sessions: {
        ...state.sessions,
        [sessionId]: {
          ...session,
          isRunning: false,
          exitCode,
          abortController: null,
        },
      },
    };
  });
}

async function streamFromServer(
  clientSessionId: string,
  command: string,
  workspaceId: string,
  abortController: AbortController,
  set: (updater: (state: CommandState) => Partial<CommandState>) => void,
  get: () => CommandState,
) {
  try {
    const res = await fetch("/api/commands/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ command, workspaceId }),
      signal: abortController.signal,
    });

    if (!res.ok || !res.body) {
      const error = await res
        .json()
        .catch(() => ({ error: "Failed to start command" }));
      appendLines(
        set,
        clientSessionId,
        `\x1b[31mError: ${error.error}\x1b[0m\n`,
      );
      markExited(set, clientSessionId, 1);
      return;
    }

    // The server assigns a real sessionId — re-key the session under the server's ID
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let serverSessionId: string | null = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      let currentEventType = "";
      for (const line of lines) {
        if (line.startsWith("event: ")) {
          currentEventType = line.slice(7);
        } else if (line.startsWith("data: ")) {
          const payload = line.slice(6);
          try {
            const parsed = JSON.parse(payload) as Record<string, unknown>;
            const activeId = serverSessionId ?? clientSessionId;

            switch (currentEventType) {
              case "session": {
                serverSessionId = parsed.sessionId as string;
                // Re-key session from client-generated ID to server-assigned ID
                if (serverSessionId !== clientSessionId) {
                  set((state) => {
                    const existing = state.sessions[clientSessionId];
                    if (!existing) return state;
                    const { [clientSessionId]: _, ...rest } = state.sessions;
                    return {
                      sessions: {
                        ...rest,
                        [serverSessionId!]: {
                          ...existing,
                          sessionId: serverSessionId!,
                        },
                      },
                      activeSessionId:
                        state.activeSessionId === clientSessionId
                          ? serverSessionId!
                          : state.activeSessionId,
                    };
                  });
                }
                break;
              }
              case "data":
                appendLines(set, activeId, parsed.data as string);
                break;
              case "exit":
                markExited(set, activeId, (parsed.exitCode as number) ?? null);
                break;
              case "error":
                appendLines(
                  set,
                  activeId,
                  `\x1b[31mError: ${parsed.message}\x1b[0m\n`,
                );
                markExited(set, activeId, 1);
                break;
            }
          } catch {
            // Skip malformed events
          }
          currentEventType = "";
        }
      }
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return;
    const activeId = get().sessions[clientSessionId] ? clientSessionId : null;
    if (activeId) {
      appendLines(set, activeId, `\x1b[31mConnection lost\x1b[0m\n`);
      markExited(set, activeId, null);
    }
  }
}
