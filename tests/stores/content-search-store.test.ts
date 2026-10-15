import { beforeEach, describe, expect, it } from "vitest";
import { CONTENT_SEARCH_DEFAULT_MAX_RESULTS } from "@devhub/shared";
import {
  buildContentSearchQuery,
  useContentSearchStore,
} from "@/stores/content-search-store";

function resetStore() {
  useContentSearchStore.setState({
    pattern: "",
    isRegex: false,
    isCaseSensitive: false,
    isWholeWord: false,
    includeText: "",
    excludeText: "",
    isDetailsOpen: false,
    sidebarView: "explorer",
    pendingFocus: false,
  });
}

describe("requestOpen", () => {
  beforeEach(resetStore);

  it("switches to the search view, prefills the pattern and requests focus", () => {
    // When
    useContentSearchStore.getState().requestOpen("needle");

    // Then
    const state = useContentSearchStore.getState();
    expect(state.sidebarView).toBe("search");
    expect(state.pattern).toBe("needle");
    expect(state.pendingFocus).toBe(true);
  });

  it("keeps the previous pattern when there is no prefill", () => {
    // Given
    useContentSearchStore.getState().setPattern("previous");

    // When
    useContentSearchStore.getState().requestOpen(null);

    // Then
    const state = useContentSearchStore.getState();
    expect(state.sidebarView).toBe("search");
    expect(state.pattern).toBe("previous");
    expect(state.pendingFocus).toBe(true);
  });

  it("keeps the previous pattern when the prefill is empty", () => {
    // Given
    useContentSearchStore.getState().setPattern("previous");

    // When
    useContentSearchStore.getState().requestOpen("");

    // Then
    expect(useContentSearchStore.getState().pattern).toBe("previous");
  });
});

describe("consumeFocus", () => {
  beforeEach(resetStore);

  it("clears a pending focus request", () => {
    // Given
    useContentSearchStore.getState().requestOpen(null);

    // When
    useContentSearchStore.getState().consumeFocus();

    // Then
    expect(useContentSearchStore.getState().pendingFocus).toBe(false);
  });
});

describe("setters", () => {
  beforeEach(resetStore);

  it("updates each search field", () => {
    // When
    const state = useContentSearchStore.getState();
    state.setPattern("foo");
    state.setIsRegex(true);
    state.setIsCaseSensitive(true);
    state.setIsWholeWord(true);
    state.setIncludeText("src/**");
    state.setExcludeText("dist/**");
    state.setIsDetailsOpen(true);
    state.setSidebarView("search");

    // Then
    expect(useContentSearchStore.getState()).toMatchObject({
      pattern: "foo",
      isRegex: true,
      isCaseSensitive: true,
      isWholeWord: true,
      includeText: "src/**",
      excludeText: "dist/**",
      isDetailsOpen: true,
      sidebarView: "search",
    });
  });
});

describe("persistence", () => {
  beforeEach(resetStore);

  it("persists the search fields and view but not the focus request", () => {
    // Given
    useContentSearchStore.getState().requestOpen("needle");
    const partialize = useContentSearchStore.persist.getOptions().partialize;
    expect(partialize).toBeDefined();

    // When
    const persisted = partialize?.(useContentSearchStore.getState());

    // Then
    expect(persisted).toEqual({
      pattern: "needle",
      isRegex: false,
      isCaseSensitive: false,
      isWholeWord: false,
      includeText: "",
      excludeText: "",
      isDetailsOpen: false,
      sidebarView: "search",
    });
  });

  it("uses the dev-hub:content-search storage key", () => {
    expect(useContentSearchStore.persist.getOptions().name).toBe(
      "dev-hub:content-search",
    );
  });
});

describe("buildContentSearchQuery", () => {
  it("splits comma-separated globs and applies the default result cap", () => {
    // When
    const query = buildContentSearchQuery({
      pattern: "needle",
      isRegex: true,
      isCaseSensitive: true,
      isWholeWord: false,
      includeText: "src/**, lib/**,,",
      excludeText: " *.test.ts ",
    });

    // Then
    expect(query).toEqual({
      pattern: "needle",
      isRegex: true,
      isCaseSensitive: true,
      isWholeWord: false,
      includeGlobs: ["src/**", "lib/**"],
      excludeGlobs: ["*.test.ts"],
      maxResults: CONTENT_SEARCH_DEFAULT_MAX_RESULTS,
    });
  });

  it("produces empty glob lists for empty text", () => {
    // When
    const query = buildContentSearchQuery({
      pattern: "x",
      isRegex: false,
      isCaseSensitive: false,
      isWholeWord: true,
      includeText: "",
      excludeText: "  ",
    });

    // Then
    expect(query.includeGlobs).toEqual([]);
    expect(query.excludeGlobs).toEqual([]);
  });
});
