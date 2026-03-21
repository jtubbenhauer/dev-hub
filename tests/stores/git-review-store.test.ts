import { describe, it, expect, beforeEach } from "vitest";
import { useGitReviewStore } from "@/stores/git-review-store";

describe("git-review-store", () => {
  beforeEach(() => {
    useGitReviewStore.getState().clearAll();
  });

  it("getReviewedFiles returns empty Set for unknown key", () => {
    const result = useGitReviewStore.getState().getReviewedFiles("unknown");
    expect(result.size).toBe(0);
  });

  it("toggleReviewed adds a file to the reviewed set", () => {
    useGitReviewStore.getState().toggleReviewed("ws1:working:", "file.ts");
    const result = useGitReviewStore
      .getState()
      .getReviewedFiles("ws1:working:");
    expect(result.has("file.ts")).toBe(true);
    expect(result.size).toBe(1);
  });

  it("toggleReviewed removes a file if already reviewed (toggle off)", () => {
    const store = useGitReviewStore.getState();
    store.toggleReviewed("ws1:working:", "file.ts");
    store.toggleReviewed("ws1:working:", "file.ts");
    const result = useGitReviewStore
      .getState()
      .getReviewedFiles("ws1:working:");
    expect(result.has("file.ts")).toBe(false);
    expect(result.size).toBe(0);
  });

  it("multiple files can be reviewed under the same key", () => {
    const store = useGitReviewStore.getState();
    store.toggleReviewed("key", "a.ts");
    store.toggleReviewed("key", "b.ts");
    store.toggleReviewed("key", "c.ts");
    const result = useGitReviewStore.getState().getReviewedFiles("key");
    expect(result.size).toBe(3);
    expect(result.has("a.ts")).toBe(true);
    expect(result.has("b.ts")).toBe(true);
    expect(result.has("c.ts")).toBe(true);
  });

  it("different keys have independent reviewed sets", () => {
    const store = useGitReviewStore.getState();
    store.toggleReviewed("ws1:working:", "a.ts");
    store.toggleReviewed("ws1:branch:main", "b.ts");
    const working = useGitReviewStore
      .getState()
      .getReviewedFiles("ws1:working:");
    const branch = useGitReviewStore
      .getState()
      .getReviewedFiles("ws1:branch:main");
    expect(working.has("a.ts")).toBe(true);
    expect(working.has("b.ts")).toBe(false);
    expect(branch.has("b.ts")).toBe(true);
    expect(branch.has("a.ts")).toBe(false);
  });

  it("clearReviewed clears only the specified key", () => {
    const store = useGitReviewStore.getState();
    store.toggleReviewed("key1", "a.ts");
    store.toggleReviewed("key2", "b.ts");
    store.clearReviewed("key1");
    expect(useGitReviewStore.getState().getReviewedFiles("key1").size).toBe(0);
    expect(
      useGitReviewStore.getState().getReviewedFiles("key2").has("b.ts"),
    ).toBe(true);
  });

  it("clearAll clears every key", () => {
    const store = useGitReviewStore.getState();
    store.toggleReviewed("key1", "a.ts");
    store.toggleReviewed("key2", "b.ts");
    store.clearAll();
    expect(useGitReviewStore.getState().getReviewedFiles("key1").size).toBe(0);
    expect(useGitReviewStore.getState().getReviewedFiles("key2").size).toBe(0);
  });

  it("state survives store re-access (simulating component remount)", () => {
    useGitReviewStore.getState().toggleReviewed("ws1:working:", "persisted.ts");
    // Access the store fresh — same as a remounted component would
    const result = useGitReviewStore
      .getState()
      .getReviewedFiles("ws1:working:");
    expect(result.has("persisted.ts")).toBe(true);
  });
});
