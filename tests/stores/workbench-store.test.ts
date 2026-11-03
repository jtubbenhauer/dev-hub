import { beforeEach, describe, expect, it } from "vitest";
import { Orientation, type SerializedDockview } from "dockview-react";
import type { WorkbenchTabParams } from "@/lib/workbench/tab-descriptors";
import {
  getLastFocusedChatSessionId,
  layoutStorageKey,
  useWorkbenchStore,
} from "@/stores/workbench-store";

const PERSIST_NAME = "dev-hub:workbench";

function makeLayout(panelId: string): SerializedDockview {
  return {
    grid: {
      root: {
        type: "branch",
        data: [
          {
            type: "leaf",
            data: { id: "group-1", views: [panelId], activeView: panelId },
            size: 200,
          },
        ],
        size: 100,
      },
      height: 100,
      width: 200,
      orientation: Orientation.HORIZONTAL,
    },
    panels: { [panelId]: { id: panelId, contentComponent: "file" } },
  };
}

const chatParams = (
  workspaceId: string,
  sessionId: string | null,
): WorkbenchTabParams => ({ kind: "chat", workspaceId, sessionId });

const fileParams = (workspaceId: string, path: string): WorkbenchTabParams => ({
  kind: "file",
  workspaceId,
  path,
});

function readPersistedJson(): {
  version: unknown;
  state: Record<string, unknown>;
} {
  const raw = localStorage.getItem(PERSIST_NAME);
  if (raw === null) throw new Error("nothing persisted");
  return JSON.parse(raw);
}

beforeEach(() => {
  localStorage.clear();
  useWorkbenchStore.setState(useWorkbenchStore.getInitialState(), true);
});

describe("layoutStorageKey", () => {
  it("uses the bare workspace id on desktop", () => {
    expect(layoutStorageKey("w", false)).toBe("w");
  });

  it("appends ::mobile on mobile", () => {
    expect(layoutStorageKey("w", true)).toBe("w::mobile");
  });
});

describe("saveLayout / getLayout", () => {
  it("returns the saved layout for its key", () => {
    const layout = makeLayout("tab-1");
    useWorkbenchStore.getState().saveLayout("a", layout);
    expect(useWorkbenchStore.getState().getLayout("a")).toEqual(layout);
  });

  it("returns null for an unknown key", () => {
    expect(useWorkbenchStore.getState().getLayout("missing")).toBeNull();
  });

  it("keeps desktop and mobile layouts separate", () => {
    const { saveLayout } = useWorkbenchStore.getState();
    saveLayout(layoutStorageKey("a", false), makeLayout("desktop"));
    saveLayout(layoutStorageKey("a", true), makeLayout("mobile"));
    const { getLayout } = useWorkbenchStore.getState();
    expect(getLayout("a")).toEqual(makeLayout("desktop"));
    expect(getLayout("a::mobile")).toEqual(makeLayout("mobile"));
  });
});

describe("setFocusedPanel", () => {
  it("sets focusedPanel and records the last focused entry for its kind", () => {
    const params = chatParams("a", "ses-1");
    useWorkbenchStore
      .getState()
      .setFocusedPanel({ workspaceId: "a", panelId: "tab-1", params });
    const state = useWorkbenchStore.getState();
    expect(state.focusedPanel).toEqual({
      workspaceId: "a",
      panelId: "tab-1",
      params,
    });
    expect(state.lastFocusedPanelByWorkspace.a?.chat).toEqual({
      panelId: "tab-1",
      params,
    });
  });

  it("records one last focused entry per kind", () => {
    const { setFocusedPanel } = useWorkbenchStore.getState();
    setFocusedPanel({
      workspaceId: "a",
      panelId: "tab-chat",
      params: chatParams("a", "ses-1"),
    });
    setFocusedPanel({
      workspaceId: "a",
      panelId: "tab-file",
      params: fileParams("a", "src/a.ts"),
    });
    const entries = useWorkbenchStore.getState().lastFocusedPanelByWorkspace.a;
    expect(entries?.chat?.panelId).toBe("tab-chat");
    expect(entries?.file?.panelId).toBe("tab-file");
  });

  it("does not record a launcher as last focused", () => {
    useWorkbenchStore.getState().setFocusedPanel({
      workspaceId: "a",
      panelId: "tab-launcher",
      params: { kind: "launcher", workspaceId: "a" },
    });
    const state = useWorkbenchStore.getState();
    expect(state.focusedPanel?.panelId).toBe("tab-launcher");
    expect(state.lastFocusedPanelByWorkspace.a?.launcher).toBeUndefined();
  });

  it("clears focusedPanel on null and keeps the last focused entries", () => {
    const { setFocusedPanel } = useWorkbenchStore.getState();
    setFocusedPanel({
      workspaceId: "a",
      panelId: "tab-1",
      params: chatParams("a", "ses-1"),
    });
    setFocusedPanel(null);
    const state = useWorkbenchStore.getState();
    expect(state.focusedPanel).toBeNull();
    expect(state.lastFocusedPanelByWorkspace.a?.chat?.panelId).toBe("tab-1");
  });
});

describe("updateLastFocusedParams", () => {
  it("retargets the last focused entry of the same panel", () => {
    const { setFocusedPanel, updateLastFocusedParams } =
      useWorkbenchStore.getState();
    setFocusedPanel({
      workspaceId: "a",
      panelId: "tab-1",
      params: chatParams("a", null),
    });
    updateLastFocusedParams("a", "tab-1", chatParams("a", "ses-2"));
    const state = useWorkbenchStore.getState();
    expect(state.lastFocusedPanelByWorkspace.a?.chat).toEqual({
      panelId: "tab-1",
      params: chatParams("a", "ses-2"),
    });
    expect(state.focusedPanel?.params).toEqual(chatParams("a", "ses-2"));
  });

  it("leaves the entry alone when it points at a different panel", () => {
    const { setFocusedPanel, updateLastFocusedParams } =
      useWorkbenchStore.getState();
    setFocusedPanel({
      workspaceId: "a",
      panelId: "tab-1",
      params: chatParams("a", "ses-1"),
    });
    updateLastFocusedParams("a", "tab-other", chatParams("a", "ses-9"));
    expect(
      useWorkbenchStore.getState().lastFocusedPanelByWorkspace.a?.chat,
    ).toEqual({ panelId: "tab-1", params: chatParams("a", "ses-1") });
  });
});

describe("forgetPanel", () => {
  it("clears the matching last focused entry and keeps the others", () => {
    const { setFocusedPanel, forgetPanel } = useWorkbenchStore.getState();
    setFocusedPanel({
      workspaceId: "a",
      panelId: "tab-chat",
      params: chatParams("a", "ses-1"),
    });
    setFocusedPanel({
      workspaceId: "a",
      panelId: "tab-file",
      params: fileParams("a", "a.ts"),
    });
    forgetPanel("a", "tab-chat");
    const entries = useWorkbenchStore.getState().lastFocusedPanelByWorkspace.a;
    expect(entries?.chat).toBeUndefined();
    expect(entries?.file?.panelId).toBe("tab-file");
  });

  it("does not touch another workspace with the same panel id", () => {
    const { setFocusedPanel, forgetPanel } = useWorkbenchStore.getState();
    setFocusedPanel({
      workspaceId: "b",
      panelId: "tab-1",
      params: chatParams("b", "ses-b"),
    });
    forgetPanel("a", "tab-1");
    expect(
      useWorkbenchStore.getState().lastFocusedPanelByWorkspace.b?.chat?.panelId,
    ).toBe("tab-1");
  });

  it("clears focusedPanel when it is the forgotten panel", () => {
    const { setFocusedPanel, forgetPanel } = useWorkbenchStore.getState();
    setFocusedPanel({
      workspaceId: "a",
      panelId: "tab-1",
      params: fileParams("a", "a.ts"),
    });
    forgetPanel("a", "tab-1");
    expect(useWorkbenchStore.getState().focusedPanel).toBeNull();
  });
});

describe("setLayoutReadyWorkspaceId", () => {
  it("stores and clears the ready workspace id", () => {
    const { setLayoutReadyWorkspaceId } = useWorkbenchStore.getState();
    setLayoutReadyWorkspaceId("a");
    expect(useWorkbenchStore.getState().layoutReadyWorkspaceId).toBe("a");
    setLayoutReadyWorkspaceId(null);
    expect(useWorkbenchStore.getState().layoutReadyWorkspaceId).toBeNull();
  });
});

describe("pendingChatTarget queue", () => {
  it("overwrites a previous pending target", () => {
    const { requestChatTarget } = useWorkbenchStore.getState();
    requestChatTarget({ workspaceId: "a", sessionId: "ses-1", panelId: null });
    requestChatTarget({
      workspaceId: "a",
      sessionId: "ses-2",
      panelId: "tab-1",
    });
    expect(useWorkbenchStore.getState().pendingChatTarget).toEqual({
      workspaceId: "a",
      sessionId: "ses-2",
      panelId: "tab-1",
    });
  });

  it("keeps a target for another workspace and returns it once for its own", () => {
    const target = { workspaceId: "b", sessionId: "ses-b", panelId: null };
    useWorkbenchStore.getState().requestChatTarget(target);

    expect(useWorkbenchStore.getState().takePendingChatTarget("a")).toBeNull();
    expect(useWorkbenchStore.getState().pendingChatTarget).toEqual(target);

    expect(useWorkbenchStore.getState().takePendingChatTarget("b")).toEqual(
      target,
    );
    expect(useWorkbenchStore.getState().takePendingChatTarget("b")).toBeNull();
    expect(useWorkbenchStore.getState().pendingChatTarget).toBeNull();
  });
});

describe("pruneWorkspaces", () => {
  it("removes layouts of unknown workspaces, desktop and mobile", () => {
    const { saveLayout } = useWorkbenchStore.getState();
    saveLayout("a", makeLayout("a1"));
    saveLayout("a::mobile", makeLayout("a2"));
    saveLayout("b", makeLayout("b1"));
    saveLayout("b::mobile", makeLayout("b2"));
    useWorkbenchStore.getState().pruneWorkspaces(["a"]);
    expect(
      Object.keys(useWorkbenchStore.getState().layoutsByKey).sort(),
    ).toEqual(["a", "a::mobile"]);
  });

  it("removes last focused entries of unknown workspaces", () => {
    const { setFocusedPanel } = useWorkbenchStore.getState();
    setFocusedPanel({
      workspaceId: "a",
      panelId: "tab-a",
      params: fileParams("a", "a.ts"),
    });
    setFocusedPanel({
      workspaceId: "b",
      panelId: "tab-b",
      params: fileParams("b", "b.ts"),
    });
    useWorkbenchStore.getState().pruneWorkspaces(["a"]);
    expect(
      Object.keys(useWorkbenchStore.getState().lastFocusedPanelByWorkspace),
    ).toEqual(["a"]);
  });

  it("keeps state identity when nothing is pruned", () => {
    useWorkbenchStore.getState().saveLayout("a", makeLayout("a1"));
    const before = useWorkbenchStore.getState().layoutsByKey;
    useWorkbenchStore.getState().pruneWorkspaces(["a"]);
    expect(useWorkbenchStore.getState().layoutsByKey).toBe(before);
  });
});

describe("getLastFocusedChatSessionId", () => {
  it("returns the session of the last focused chat tab", () => {
    useWorkbenchStore.getState().setFocusedPanel({
      workspaceId: "a",
      panelId: "tab-1",
      params: chatParams("a", "ses-1"),
    });
    expect(getLastFocusedChatSessionId("a")).toBe("ses-1");
  });

  it("returns null for a new-chat tab without a session", () => {
    useWorkbenchStore.getState().setFocusedPanel({
      workspaceId: "a",
      panelId: "tab-1",
      params: chatParams("a", null),
    });
    expect(getLastFocusedChatSessionId("a")).toBeNull();
  });

  it("returns null for an unknown workspace", () => {
    expect(getLastFocusedChatSessionId("nope")).toBeNull();
  });
});

describe("persistence", () => {
  it("uses the dev-hub:workbench name at version 1", () => {
    const options = useWorkbenchStore.persist.getOptions();
    expect(options.name).toBe(PERSIST_NAME);
    expect(options.version).toBe(1);
  });

  it("persists only layouts and last focused panels", () => {
    const state = useWorkbenchStore.getState();
    state.saveLayout("a", makeLayout("tab-1"));
    state.setFocusedPanel({
      workspaceId: "a",
      panelId: "tab-1",
      params: chatParams("a", "ses-1"),
    });
    state.setLayoutReadyWorkspaceId("a");
    state.requestChatTarget({
      workspaceId: "a",
      sessionId: "ses-1",
      panelId: null,
    });

    const persisted = readPersistedJson();
    expect(persisted.version).toBe(1);
    const persistedState = persisted.state;
    expect(Object.keys(persistedState).sort()).toEqual([
      "lastFocusedPanelByWorkspace",
      "layoutsByKey",
    ]);
    expect(persistedState).not.toHaveProperty("focusedPanel");
    expect(persistedState).not.toHaveProperty("pendingChatTarget");
    expect(persistedState).not.toHaveProperty("layoutReadyWorkspaceId");
  });

  it("restores valid layouts and last focused entries on rehydrate", async () => {
    const layout = makeLayout("tab-1");
    localStorage.setItem(
      PERSIST_NAME,
      JSON.stringify({
        version: 1,
        state: {
          layoutsByKey: { a: layout },
          lastFocusedPanelByWorkspace: {
            a: { chat: { panelId: "tab-1", params: chatParams("a", "s1") } },
          },
        },
      }),
    );
    await useWorkbenchStore.persist.rehydrate();
    const state = useWorkbenchStore.getState();
    expect(state.layoutsByKey).toEqual({ a: layout });
    expect(getLastFocusedChatSessionId("a")).toBe("s1");
  });

  it("drops corrupt entries and never hydrates transient fields", async () => {
    localStorage.setItem(
      PERSIST_NAME,
      JSON.stringify({
        version: 1,
        state: {
          layoutsByKey: { a: "not a layout", b: makeLayout("tab-b"), c: null },
          lastFocusedPanelByWorkspace: {
            a: {
              chat: { panelId: 7, params: chatParams("a", "s1") },
              file: { panelId: "tab-f", params: { kind: "file" } },
              launcher: {
                panelId: "tab-l",
                params: { kind: "launcher", workspaceId: "a" },
              },
              diff: { panelId: "tab-d", params: fileParams("a", "x.ts") },
            },
            b: "garbage",
          },
          focusedPanel: { workspaceId: "a", panelId: "tab-1" },
          pendingChatTarget: {
            workspaceId: "a",
            sessionId: "s",
            panelId: null,
          },
        },
      }),
    );
    await useWorkbenchStore.persist.rehydrate();
    const state = useWorkbenchStore.getState();
    expect(Object.keys(state.layoutsByKey)).toEqual(["b"]);
    expect(state.lastFocusedPanelByWorkspace).toEqual({});
    expect(state.focusedPanel).toBeNull();
    expect(state.pendingChatTarget).toBeNull();
  });

  it("falls back to defaults when the persisted state is not an object", () => {
    const merge = useWorkbenchStore.persist.getOptions().merge;
    if (!merge) throw new Error("merge option missing");
    const merged = merge("garbage", useWorkbenchStore.getState());
    expect(merged.layoutsByKey).toEqual({});
    expect(merged.lastFocusedPanelByWorkspace).toEqual({});
  });

  it("does not throw on invalid JSON in storage", async () => {
    localStorage.setItem(PERSIST_NAME, "{not json");
    await useWorkbenchStore.persist.rehydrate();
    expect(useWorkbenchStore.getState().layoutsByKey).toEqual({});
  });
});
