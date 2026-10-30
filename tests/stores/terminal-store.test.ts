import { beforeEach, describe, expect, it } from "vitest";
import {
  getActiveTerminalKey,
  MIN_DRAWER_HEIGHT_PX,
  useTerminalStore,
} from "@/stores/terminal-store";

beforeEach(() => {
  useTerminalStore.setState({
    isOpen: false,
    drawerHeightPx: null,
    isMaximized: false,
    tabsByWorkspace: {},
    activeTabByWorkspace: {},
    unseenActivityKeys: {},
    endedSessionKeys: {},
  });
});

describe("terminal tabs", () => {
  it("starts a workspace on the legacy default session", () => {
    useTerminalStore.getState().ensureTab("ws-1");
    const state = useTerminalStore.getState();
    expect(state.tabsByWorkspace["ws-1"]).toEqual([
      { sessionId: "default", title: "Terminal 1" },
    ]);
    expect(getActiveTerminalKey(state, "ws-1")).toBe("ws-1:default");
  });

  it("numbers new tabs and keeps the first tab active", () => {
    const store = useTerminalStore.getState();
    store.ensureTab("ws-1");
    const second = store.addTab("ws-1");
    const tabs = useTerminalStore.getState().tabsByWorkspace["ws-1"];
    expect(tabs.map((tab) => tab.title)).toEqual(["Terminal 1", "Terminal 2"]);
    expect(second).toMatch(/^term-/);
    expect(useTerminalStore.getState().activeTabByWorkspace["ws-1"]).toBe(
      "default",
    );
  });

  it("does not duplicate a tab for a session that already has one", () => {
    const store = useTerminalStore.getState();
    store.addTab("ws-1", "term-x");
    store.addTab("ws-1", "term-x");
    expect(useTerminalStore.getState().tabsByWorkspace["ws-1"]).toHaveLength(1);
  });

  it("activates a neighbour when the active tab closes and remembers the ended session", () => {
    const store = useTerminalStore.getState();
    store.ensureTab("ws-1");
    const second = store.addTab("ws-1");
    store.closeTab("ws-1", "default");
    const state = useTerminalStore.getState();
    expect(state.activeTabByWorkspace["ws-1"]).toBe(second);
    expect(state.endedSessionKeys["ws-1:default"]).toBe(true);
  });

  it("gives a fresh session id after the last tab is closed", () => {
    const store = useTerminalStore.getState();
    store.ensureTab("ws-1");
    store.closeTab("ws-1", "default");
    store.ensureTab("ws-1");
    const [tab] = useTerminalStore.getState().tabsByWorkspace["ws-1"];
    expect(tab.sessionId).not.toBe("default");
    expect(useTerminalStore.getState().activeTabByWorkspace["ws-1"]).toBe(
      tab.sessionId,
    );
  });
});

describe("drawer size", () => {
  it("clamps the height and leaves maximized mode when resized", () => {
    const store = useTerminalStore.getState();
    store.setMaximized(true);
    store.setDrawerHeightPx(20);
    const state = useTerminalStore.getState();
    expect(state.drawerHeightPx).toBe(MIN_DRAWER_HEIGHT_PX);
    expect(state.isMaximized).toBe(false);
  });
});
