import { beforeEach, describe, expect, it } from "vitest";
import { useSessionSidebarStore } from "@/stores/session-sidebar-store";

const PERSIST_NAME = "dev-hub:session-sidebar";

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
  useSessionSidebarStore.setState(
    useSessionSidebarStore.getInitialState(),
    true,
  );
});

describe("defaults", () => {
  it("starts open with the mobile sheet closed", () => {
    const state = useSessionSidebarStore.getState();
    expect(state.isOpen).toBe(true);
    expect(state.isMobileSheetOpen).toBe(false);
  });
});

describe("open state", () => {
  it("setOpen sets isOpen", () => {
    useSessionSidebarStore.getState().setOpen(false);
    expect(useSessionSidebarStore.getState().isOpen).toBe(false);
  });

  it("toggle flips isOpen", () => {
    useSessionSidebarStore.getState().toggle();
    expect(useSessionSidebarStore.getState().isOpen).toBe(false);
    useSessionSidebarStore.getState().toggle();
    expect(useSessionSidebarStore.getState().isOpen).toBe(true);
  });
});

describe("mobile sheet", () => {
  it("setMobileSheetOpen sets isMobileSheetOpen without touching isOpen", () => {
    // Given
    useSessionSidebarStore.getState().setOpen(false);

    // When
    useSessionSidebarStore.getState().setMobileSheetOpen(true);

    // Then
    const state = useSessionSidebarStore.getState();
    expect(state.isMobileSheetOpen).toBe(true);
    expect(state.isOpen).toBe(false);
  });

  it("toggle flips the desktop isOpen only", () => {
    // When
    useSessionSidebarStore.getState().toggle();

    // Then
    expect(useSessionSidebarStore.getState().isMobileSheetOpen).toBe(false);
  });
});

describe("persistence", () => {
  it("uses the dev-hub:session-sidebar name at version 1", () => {
    const options = useSessionSidebarStore.persist.getOptions();
    expect(options.name).toBe(PERSIST_NAME);
    expect(options.version).toBe(1);
  });

  it("persists isOpen only", () => {
    // When
    useSessionSidebarStore.getState().setOpen(false);

    // Then
    const persisted = readPersistedJson();
    expect(persisted.version).toBe(1);
    expect(persisted.state).toEqual({ isOpen: false });
  });

  it("never persists isMobileSheetOpen", () => {
    // When
    useSessionSidebarStore.getState().setMobileSheetOpen(true);

    // Then
    expect(readPersistedJson().state).not.toHaveProperty("isMobileSheetOpen");
  });

  it("restores a persisted closed sidebar on rehydrate", async () => {
    // Given
    localStorage.setItem(
      PERSIST_NAME,
      JSON.stringify({ version: 1, state: { isOpen: false } }),
    );

    // When
    await useSessionSidebarStore.persist.rehydrate();

    // Then
    expect(useSessionSidebarStore.getState().isOpen).toBe(false);
  });

  it("keeps the mobile sheet closed when storage claims it was open", async () => {
    // Given
    localStorage.setItem(
      PERSIST_NAME,
      JSON.stringify({
        version: 1,
        state: { isOpen: false, isMobileSheetOpen: true },
      }),
    );

    // When
    await useSessionSidebarStore.persist.rehydrate();

    // Then
    const state = useSessionSidebarStore.getState();
    expect(state.isOpen).toBe(false);
    expect(state.isMobileSheetOpen).toBe(false);
  });

  it("sanitizes a corrupt persisted isOpen on rehydrate", async () => {
    // Given
    localStorage.setItem(
      PERSIST_NAME,
      JSON.stringify({ version: 1, state: { isOpen: "yes" } }),
    );

    // When
    await useSessionSidebarStore.persist.rehydrate();

    // Then
    expect(useSessionSidebarStore.getState().isOpen).toBe(true);
  });

  it("falls back to defaults when the persisted state is not an object", () => {
    const merge = useSessionSidebarStore.persist.getOptions().merge;
    if (!merge) throw new Error("merge option missing");
    const merged = merge(null, useSessionSidebarStore.getState());
    expect(merged.isOpen).toBe(true);
    expect(merged.isMobileSheetOpen).toBe(false);
  });
});
