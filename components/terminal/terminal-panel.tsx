"use client";

import {
  useEffect,
  useRef,
  useCallback,
  useState,
  type MouseEvent,
  type WheelEvent,
} from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SearchAddon } from "@xterm/addon-search";
import "@xterm/xterm/css/xterm.css";
import { buildTerminalTheme, observeThemeChanges } from "./terminal-theme";
import { TerminalSearchBar } from "./terminal-search-bar";
import { openTerminalLink } from "@/lib/terminal/terminal-links";
import {
  classifySocketClose,
  isMacPlatform,
  matchTerminalShortcut,
  MAX_RECONNECT_ATTEMPTS,
  reconnectDelayMs,
} from "@/lib/terminal/terminal-client-utils";
import {
  parseServerMessage,
  type TerminalClientMessage,
} from "@/lib/terminal/terminal-protocol";

export interface TerminalHandle {
  write: (data: string) => void;
  focus: () => void;
  blur: () => void;
  getSelection: () => string;
}

interface TerminalPanelProps {
  wsUrl: string;
  workspaceId: string;
  cwd: string;
  shellCommand: string | null;
  scrollback?: number;
  sessionId?: string;
  envOverrides?: Record<string, string>;
  onReady?: (handle: TerminalHandle) => void;
  fontFamily?: string;
  autoFocus?: boolean;
  hasShellFeatures?: boolean;
  idleTimeoutMinutes?: number;
}

type ConnectionState =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "exited"
  | "replaced"
  | "ended"
  | "error";

const STATUS_LABELS: Record<Exclude<ConnectionState, "connected">, string> = {
  connecting: "Connecting...",
  reconnecting: "Connection lost. Reconnecting...",
  disconnected: "Disconnected",
  exited: "Process exited",
  replaced: "This session is open in another window",
  ended: "Session ended",
  error: "Connection error",
};

const STATUS_ACTIONS: Record<
  Exclude<ConnectionState, "connected">,
  string | null
> = {
  connecting: null,
  reconnecting: "Retry now",
  disconnected: "Reconnect",
  exited: "Restart",
  replaced: "Take over",
  ended: "Start new session",
  error: "Retry",
};

const DEFAULT_SCROLLBACK = 5000;
const DEFAULT_FONT_FAMILY = "var(--font-geist-mono), monospace";

async function fetchSocketToken(workspaceId: string): Promise<string> {
  const res = await fetch(
    `/api/terminal/token?workspaceId=${encodeURIComponent(workspaceId)}`,
  );
  if (!res.ok) throw new Error(`Failed to authorize terminal (${res.status})`);
  const body = (await res.json()) as { token?: string };
  if (!body.token) throw new Error("Failed to authorize terminal");
  return body.token;
}

export function TerminalPanel({
  wsUrl,
  workspaceId,
  cwd,
  shellCommand,
  scrollback = DEFAULT_SCROLLBACK,
  sessionId,
  envOverrides,
  onReady,
  fontFamily = DEFAULT_FONT_FAMILY,
  autoFocus = true,
  hasShellFeatures = false,
  idleTimeoutMinutes,
}: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const socketGenerationRef = useRef(0);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectNowRef = useRef<(() => void) | null>(null);
  const shellCommandRef = useRef(shellCommand);
  const envOverridesRef = useRef(envOverrides);
  const onReadyRef = useRef(onReady);
  const autoFocusRef = useRef(autoFocus);
  const hasShellFeaturesRef = useRef(hasShellFeatures);
  const idleTimeoutMinutesRef = useRef(idleTimeoutMinutes);
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("connecting");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [searchAddon, setSearchAddon] = useState<SearchAddon | null>(null);
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  useEffect(() => {
    shellCommandRef.current = shellCommand;
    envOverridesRef.current = envOverrides;
    autoFocusRef.current = autoFocus;
    onReadyRef.current = onReady;
    hasShellFeaturesRef.current = hasShellFeatures;
    idleTimeoutMinutesRef.current = idleTimeoutMinutes;
  });

  useEffect(() => {
    let isDisposed = false;
    const encoder = new TextEncoder();
    const isMac = isMacPlatform();

    const sendInput = (data: string | Uint8Array) => {
      const ws = wsRef.current;
      if (ws?.readyState !== WebSocket.OPEN) return;
      ws.send(typeof data === "string" ? encoder.encode(data) : data);
    };

    const sendControl = (message: TerminalClientMessage) => {
      const ws = wsRef.current;
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
    };

    const clearReconnectTimer = () => {
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    };

    const scheduleReconnect = (term: XTerm, message: string | null) => {
      if (reconnectAttemptRef.current >= MAX_RECONNECT_ATTEMPTS) {
        setConnectionState("disconnected");
        setStatusMessage(message);
        return;
      }
      const delay = reconnectDelayMs(reconnectAttemptRef.current);
      reconnectAttemptRef.current += 1;
      setConnectionState("reconnecting");
      setStatusMessage(message);
      reconnectTimerRef.current = setTimeout(
        () => void openSocket(term),
        delay,
      );
    };

    // Each socket gets a generation number; events from a socket we have since
    // replaced or closed on purpose are ignored instead of triggering reconnects.
    const openSocket = async (term: XTerm) => {
      clearReconnectTimer();
      const generation = ++socketGenerationRef.current;
      const previousSocket = wsRef.current;
      wsRef.current = null;
      previousSocket?.close(1000);
      if (reconnectAttemptRef.current === 0) setConnectionState("connecting");

      let token: string;
      try {
        token = await fetchSocketToken(workspaceId);
      } catch (err) {
        if (generation !== socketGenerationRef.current) return;
        scheduleReconnect(
          term,
          err instanceof Error ? err.message : "Failed to authorize terminal",
        );
        return;
      }
      if (generation !== socketGenerationRef.current) return;

      const params = new URLSearchParams({
        workspaceId,
        cols: String(term.cols),
        rows: String(term.rows),
        cwd,
        scrollback: String(scrollback),
        token,
      });
      if (shellCommandRef.current)
        params.set("shellCommand", shellCommandRef.current);
      if (sessionId) params.set("sessionId", sessionId);
      if (idleTimeoutMinutesRef.current !== undefined)
        params.set("idleTimeoutMinutes", String(idleTimeoutMinutesRef.current));
      const env = envOverridesRef.current;
      if (env && Object.keys(env).length > 0) {
        params.set("env", JSON.stringify(env));
      }

      const ws = new WebSocket(`${wsUrl}?${params.toString()}`);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;
      let hasExited = false;
      let hasFatalError = false;

      ws.onopen = () => {
        if (generation !== socketGenerationRef.current) return;
        reconnectAttemptRef.current = 0;
        term.reset();
        setConnectionState("connected");
        setStatusMessage(null);
        if (autoFocusRef.current) term.focus();
        onReadyRef.current?.({
          write: (data: string) => sendInput(data),
          focus: () => term.focus(),
          blur: () => term.blur(),
          getSelection: () => term.getSelection(),
        });
      };

      ws.onmessage = (event: MessageEvent) => {
        if (generation !== socketGenerationRef.current) return;
        if (event.data instanceof ArrayBuffer) {
          term.write(new Uint8Array(event.data));
          return;
        }
        if (typeof event.data !== "string") return;
        const message = parseServerMessage(event.data);
        if (message?.type === "exit") {
          hasExited = true;
          term.writeln(
            `\r\n[Process exited with code ${message.exitCode ?? "unknown"}]`,
          );
        } else if (message?.type === "error") {
          hasFatalError = message.isFatal;
          term.writeln(`\r\n[Error: ${message.data}]`);
          setStatusMessage(message.data);
        }
      };

      ws.onclose = (event: CloseEvent) => {
        if (generation !== socketGenerationRef.current) return;
        wsRef.current = null;
        const outcome = classifySocketClose({
          closeCode: event.code,
          hasExited,
          hasFatalError,
          attempt: reconnectAttemptRef.current,
        });
        if (outcome === "reconnect") {
          scheduleReconnect(term, null);
        } else if (outcome === "give-up") {
          setConnectionState("disconnected");
        } else if (outcome === "fatal") {
          setConnectionState("error");
        } else {
          setConnectionState(outcome);
        }
      };
    };

    const setup = async () => {
      if (!containerRef.current) return;

      // Wait for the requested font to actually finish loading before creating
      // the xterm instance. document.fonts.ready alone is insufficient because
      // @font-face with font-display:swap resolves immediately with a fallback,
      // causing xterm to measure character cells with wrong metrics on first load.
      try {
        await document.fonts.load(`14px ${fontFamily}`);
      } catch {
        await document.fonts.ready;
      }

      // The effect cleanup may have fired while we were awaiting fonts (e.g.
      // React Strict Mode double-invoke). Bail out to avoid creating a second
      // xterm instance that appends to the same container.
      if (isDisposed || !containerRef.current) return;

      const term = new XTerm({
        cursorBlink: true,
        fontFamily,
        fontSize: 14,
        lineHeight: 1.2,
        scrollback,
        theme: buildTerminalTheme(),
        altClickMovesCursor: false,
      });

      const fitAddon = new FitAddon();
      const newSearchAddon = new SearchAddon();
      term.loadAddon(fitAddon);
      term.loadAddon(new WebLinksAddon(openTerminalLink));
      term.loadAddon(newSearchAddon);
      term.open(containerRef.current);

      try {
        fitAddon.fit();
      } catch {
        void 0;
      }

      termRef.current = term;
      fitAddonRef.current = fitAddon;
      setSearchAddon(newSearchAddon);

      term.attachCustomKeyEventHandler((event) => {
        if (!hasShellFeaturesRef.current) return true;
        const shortcut = matchTerminalShortcut(event, isMac);
        if (shortcut === "search") {
          event.preventDefault();
          setIsSearchOpen(true);
          return false;
        }
        if (shortcut === "clear") {
          event.preventDefault();
          term.clear();
          sendControl({ type: "clear" });
          return false;
        }
        return true;
      });

      term.onData((data) => sendInput(data));
      term.onBinary((data) =>
        sendInput(Uint8Array.from(data, (c) => c.charCodeAt(0))),
      );
      term.onResize(({ cols, rows }) =>
        sendControl({ type: "resize", cols, rows }),
      );

      reconnectNowRef.current = () => {
        reconnectAttemptRef.current = 0;
        void openSocket(term);
      };
      void openSocket(term);
    };

    void setup();

    const handleResize = () => {
      try {
        fitAddonRef.current?.fit();
      } catch {
        void 0;
      }
    };
    window.addEventListener("resize", handleResize);
    const resizeObserver = new ResizeObserver(handleResize);
    if (containerRef.current) resizeObserver.observe(containerRef.current);

    const stopObservingTheme = observeThemeChanges(() => {
      if (termRef.current) termRef.current.options.theme = buildTerminalTheme();
    });

    return () => {
      isDisposed = true;
      socketGenerationRef.current += 1;
      clearReconnectTimer();
      window.removeEventListener("resize", handleResize);
      resizeObserver.disconnect();
      stopObservingTheme();
      wsRef.current?.close(1000);
      termRef.current?.dispose();
      wsRef.current = null;
      termRef.current = null;
      fitAddonRef.current = null;
      reconnectNowRef.current = null;
    };
  }, [wsUrl, workspaceId, cwd, scrollback, sessionId, fontFamily]);

  // Re-focus xterm when the user interacts with the terminal container.
  // xterm.js only forwards mouse/wheel events to the PTY when its internal
  // textarea has focus — without this, scrolling silently stops working
  // after any click outside the terminal (toolbar, file tree, etc.).
  const handleContainerMouseDown = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      const term = termRef.current;
      if (!term) return;
      // Only refocus if the click target is the container padding area,
      // not the xterm canvas itself (xterm handles its own canvas clicks)
      if (e.target === e.currentTarget) {
        term.focus();
      }
    },
    [],
  );

  const handleContainerWheel = useCallback((_e: WheelEvent<HTMLDivElement>) => {
    termRef.current?.focus();
  }, []);

  const handleReconnect = useCallback(() => {
    reconnectNowRef.current?.();
  }, []);

  const handleCloseSearch = useCallback(() => {
    setIsSearchOpen(false);
    searchAddon?.clearDecorations();
    termRef.current?.focus();
  }, [searchAddon]);

  const actionLabel =
    connectionState === "connected" ? null : STATUS_ACTIONS[connectionState];

  return (
    <div className="relative flex h-full flex-col">
      {connectionState !== "connected" && (
        <div className="bg-muted/50 flex items-center gap-2 border-b px-3 py-1.5 text-xs">
          <span
            className={
              connectionState === "error"
                ? "text-destructive"
                : "text-muted-foreground"
            }
          >
            {STATUS_LABELS[connectionState]}
            {statusMessage ? `: ${statusMessage}` : ""}
          </span>
          {actionLabel && (
            <button
              type="button"
              onClick={handleReconnect}
              className="text-primary hover:underline"
            >
              {actionLabel}
            </button>
          )}
        </div>
      )}
      {isSearchOpen && searchAddon && (
        <TerminalSearchBar
          searchAddon={searchAddon}
          onClose={handleCloseSearch}
        />
      )}
      <div
        ref={containerRef}
        className="min-h-0 flex-1 p-1"
        onMouseDown={handleContainerMouseDown}
        onWheel={handleContainerWheel}
      />
    </div>
  );
}
