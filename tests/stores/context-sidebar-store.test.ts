import { beforeEach, describe, expect, it } from "vitest";
import { useContextSidebarStore } from "@/stores/context-sidebar-store";

const PERSIST_NAME = "dev-hub:context-sidebar";

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
  useContextSidebarStore.setState(
    useContextSidebarStore.getInitialState(),
    true,
  );
});

describe("defaults", () => {
  it("starts open on the explorer view with no focus request", () => {
    const state = useContextSidebarStore.getState();
    expect(state.isOpen).toBe(true);
    expect(state.view).toBe("explorer");
    expect(state.branchCompareBaseRefs).toEqual({});
    expect(state.focusRequest).toBeNull();
  });
});

describe("open state", () => {
  it("setOpen sets isOpen", () => {
    useContextSidebarStore.getState().setOpen(false);
    expect(useContextSidebarStore.getState().isOpen).toBe(false);
  });

  it("toggle flips isOpen", () => {
    useContextSidebarStore.getState().toggle();
    expect(useContextSidebarStore.getState().isOpen).toBe(false);
    useContextSidebarStore.getState().toggle();
    expect(useContextSidebarStore.getState().isOpen).toBe(true);
  });
});

describe("views", () => {
  it("setView changes the view without opening the sidebar", () => {
    useContextSidebarStore.getState().setOpen(false);
    useContextSidebarStore.getState().setView("status");
    const state = useContextSidebarStore.getState();
    expect(state.view).toBe("status");
    expect(state.isOpen).toBe(false);
  });

  it("openView('changes') sets the view and isOpen true", () => {
    useContextSidebarStore.getState().setOpen(false);
    useContextSidebarStore.getState().openView("changes");
    const state = useContextSidebarStore.getState();
    expect(state.view).toBe("changes");
    expect(state.isOpen).toBe(true);
  });
});

describe("setBranchCompareBaseRef", () => {
  it("stores the base ref per workspace", () => {
    const { setBranchCompareBaseRef } = useContextSidebarStore.getState();
    setBranchCompareBaseRef("a", "main");
    setBranchCompareBaseRef("b", "develop");
    setBranchCompareBaseRef("a", "qa-base");
    expect(useContextSidebarStore.getState().branchCompareBaseRefs).toEqual({
      a: "qa-base",
      b: "develop",
    });
  });
});

describe("focus requests", () => {
  it("consumeFocusRequest returns the request once, then null", () => {
    useContextSidebarStore.getState().requestFocus("file-search");
    expect(useContextSidebarStore.getState().consumeFocusRequest()).toBe(
      "file-search",
    );
    expect(useContextSidebarStore.getState().consumeFocusRequest()).toBeNull();
    expect(useContextSidebarStore.getState().focusRequest).toBeNull();
  });

  it("a newer request replaces an unconsumed one", () => {
    const { requestFocus } = useContextSidebarStore.getState();
    requestFocus("file-search");
    requestFocus("tree");
    expect(useContextSidebarStore.getState().consumeFocusRequest()).toBe(
      "tree",
    );
  });
});

describe("persistence", () => {
  it("uses the dev-hub:context-sidebar name at version 1", () => {
    const options = useContextSidebarStore.persist.getOptions();
    expect(options.name).toBe(PERSIST_NAME);
    expect(options.version).toBe(1);
  });

  it("persists isOpen, view and branchCompareBaseRefs only", () => {
    const state = useContextSidebarStore.getState();
    state.openView("compare");
    state.setBranchCompareBaseRef("a", "main");
    state.requestFocus("tree");

    const persisted = readPersistedJson();
    expect(persisted.version).toBe(1);
    expect(persisted.state).toEqual({
      isOpen: true,
      view: "compare",
      branchCompareBaseRefs: { a: "main" },
    });
  });

  it("restores valid persisted values on rehydrate", async () => {
    localStorage.setItem(
      PERSIST_NAME,
      JSON.stringify({
        version: 1,
        state: {
          isOpen: false,
          view: "status",
          branchCompareBaseRefs: { a: "main" },
        },
      }),
    );
    await useContextSidebarStore.persist.rehydrate();
    const state = useContextSidebarStore.getState();
    expect(state.isOpen).toBe(false);
    expect(state.view).toBe("status");
    expect(state.branchCompareBaseRefs).toEqual({ a: "main" });
  });

  it("sanitizes corrupt persisted values on rehydrate", async () => {
    localStorage.setItem(
      PERSIST_NAME,
      JSON.stringify({
        version: 1,
        state: {
          isOpen: "yes",
          view: "files",
          branchCompareBaseRefs: { a: "main", b: 3, c: "" },
          focusRequest: "tree",
        },
      }),
    );
    await useContextSidebarStore.persist.rehydrate();
    const state = useContextSidebarStore.getState();
    expect(state.isOpen).toBe(true);
    expect(state.view).toBe("explorer");
    expect(state.branchCompareBaseRefs).toEqual({ a: "main" });
    expect(state.focusRequest).toBeNull();
  });

  it("falls back to defaults when the persisted state is not an object", () => {
    const merge = useContextSidebarStore.persist.getOptions().merge;
    if (!merge) throw new Error("merge option missing");
    const merged = merge(null, useContextSidebarStore.getState());
    expect(merged.isOpen).toBe(true);
    expect(merged.view).toBe("explorer");
    expect(merged.branchCompareBaseRefs).toEqual({});
  });
});
