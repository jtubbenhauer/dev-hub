import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  DEFAULT_TERMINAL_SESSION_ID,
  terminalSessionKey,
} from "@/lib/terminal/terminal-protocol";
import {
  EMPTY_ACTIVITY_BASELINE,
  type TerminalActivityBaseline,
} from "@/lib/terminal/terminal-activity";

export interface TerminalTab {
  sessionId: string;
  title: string;
}

export const MIN_DRAWER_HEIGHT_PX = 160;

interface TerminalState {
  isOpen: boolean;
  drawerHeightPx: number | null;
  isMaximized: boolean;
  tabsByWorkspace: Record<string, TerminalTab[]>;
  activeTabByWorkspace: Record<string, string>;
  unseenActivityKeys: Record<string, true>;
  endedSessionKeys: Record<string, true>;
  // Lives in the store so it survives the header remounting on navigation.
  activityBaseline: TerminalActivityBaseline;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  setDrawerHeightPx: (heightPx: number) => void;
  setMaximized: (isMaximized: boolean) => void;
  ensureTab: (workspaceId: string) => void;
  addTab: (workspaceId: string, sessionId?: string) => string;
  closeTab: (workspaceId: string, sessionId: string) => void;
  setActiveTab: (workspaceId: string, sessionId: string) => void;
  setUnseenActivityKeys: (keys: Record<string, true>) => void;
  setActivityBaseline: (baseline: TerminalActivityBaseline) => void;
}

function nextTabTitle(tabs: TerminalTab[]): string {
  const highestNumber = tabs.reduce((highest, tab) => {
    const match = /^Terminal (\d+)$/.exec(tab.title);
    return match ? Math.max(highest, Number(match[1])) : highest;
  }, 0);
  return `Terminal ${highestNumber + 1}`;
}

function generateSessionId(): string {
  return `term-${crypto.randomUUID().slice(0, 8)}`;
}

export function getActiveTerminalKey(
  state: Pick<TerminalState, "activeTabByWorkspace">,
  workspaceId: string | null,
): string | null {
  if (!workspaceId) return null;
  const sessionId = state.activeTabByWorkspace[workspaceId];
  return sessionId ? terminalSessionKey(workspaceId, sessionId) : null;
}

export const useTerminalStore = create<TerminalState>()(
  persist(
    (set, get) => ({
      isOpen: false,
      drawerHeightPx: null,
      isMaximized: false,
      tabsByWorkspace: {},
      activeTabByWorkspace: {},
      unseenActivityKeys: {},
      endedSessionKeys: {},
      activityBaseline: EMPTY_ACTIVITY_BASELINE,
      setOpen: (open) => set({ isOpen: open }),
      toggle: () => set((s) => ({ isOpen: !s.isOpen })),
      setDrawerHeightPx: (heightPx) =>
        set({
          drawerHeightPx: Math.max(MIN_DRAWER_HEIGHT_PX, Math.round(heightPx)),
          isMaximized: false,
        }),
      setMaximized: (isMaximized) => set({ isMaximized }),
      // The very first tab reuses the legacy "default" session so a shell that
      // was running before tabs existed is picked up; later tabs get fresh ids.
      ensureTab: (workspaceId) => {
        const tabs = get().tabsByWorkspace[workspaceId];
        if (tabs && tabs.length > 0) {
          if (!get().activeTabByWorkspace[workspaceId]) {
            get().setActiveTab(workspaceId, tabs[0].sessionId);
          }
          return;
        }
        get().addTab(
          workspaceId,
          tabs === undefined ? DEFAULT_TERMINAL_SESSION_ID : undefined,
        );
      },
      addTab: (workspaceId, sessionId) => {
        const tabs = get().tabsByWorkspace[workspaceId] ?? [];
        const existing = sessionId
          ? tabs.find((tab) => tab.sessionId === sessionId)
          : undefined;
        if (existing) return existing.sessionId;
        const tab: TerminalTab = {
          sessionId: sessionId ?? generateSessionId(),
          title: nextTabTitle(tabs),
        };
        set((s) => ({
          tabsByWorkspace: {
            ...s.tabsByWorkspace,
            [workspaceId]: [...tabs, tab],
          },
          activeTabByWorkspace: s.activeTabByWorkspace[workspaceId]
            ? s.activeTabByWorkspace
            : { ...s.activeTabByWorkspace, [workspaceId]: tab.sessionId },
        }));
        return tab.sessionId;
      },
      closeTab: (workspaceId, sessionId) =>
        set((s) => {
          const tabs = s.tabsByWorkspace[workspaceId] ?? [];
          const index = tabs.findIndex((tab) => tab.sessionId === sessionId);
          if (index === -1) return s;
          const remaining = tabs.filter((tab) => tab.sessionId !== sessionId);
          const activeTabByWorkspace = { ...s.activeTabByWorkspace };
          if (activeTabByWorkspace[workspaceId] === sessionId) {
            const neighbour = remaining[Math.min(index, remaining.length - 1)];
            if (neighbour)
              activeTabByWorkspace[workspaceId] = neighbour.sessionId;
            else delete activeTabByWorkspace[workspaceId];
          }
          return {
            tabsByWorkspace: { ...s.tabsByWorkspace, [workspaceId]: remaining },
            activeTabByWorkspace,
            endedSessionKeys: {
              ...s.endedSessionKeys,
              [terminalSessionKey(workspaceId, sessionId)]: true,
            },
          };
        }),
      setActiveTab: (workspaceId, sessionId) =>
        set((s) => ({
          activeTabByWorkspace: {
            ...s.activeTabByWorkspace,
            [workspaceId]: sessionId,
          },
        })),
      setUnseenActivityKeys: (keys) => set({ unseenActivityKeys: keys }),
      setActivityBaseline: (baseline) => set({ activityBaseline: baseline }),
    }),
    {
      name: "dev-hub-terminal",
      partialize: (s) => ({
        isOpen: s.isOpen,
        drawerHeightPx: s.drawerHeightPx,
        isMaximized: s.isMaximized,
        tabsByWorkspace: s.tabsByWorkspace,
        activeTabByWorkspace: s.activeTabByWorkspace,
      }),
    },
  ),
);
