import { describe, it, expect, beforeEach } from "vitest";
import { useReviewDraftStore } from "@/stores/review-draft-store";

const PR_KEY = "owner/repo/42";
const PR_KEY_2 = "owner/repo/99";

function makeDraft(overrides: Record<string, unknown> = {}) {
  return {
    type: "inline" as const,
    path: "src/index.ts",
    line: 10,
    side: "RIGHT" as const,
    body: "Fix this",
    ...overrides,
  };
}

describe("review-draft-store", () => {
  beforeEach(() => {
    useReviewDraftStore.getState().clearDrafts(PR_KEY);
    useReviewDraftStore.getState().clearDrafts(PR_KEY_2);
  });

  it("getDrafts returns empty array for unknown key", () => {
    expect(useReviewDraftStore.getState().getDrafts("unknown")).toEqual([]);
  });

  it("addDraft adds a draft with a generated id", () => {
    useReviewDraftStore.getState().addDraft(PR_KEY, makeDraft());
    const drafts = useReviewDraftStore.getState().getDrafts(PR_KEY);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].body).toBe("Fix this");
    expect(drafts[0].id).toBeDefined();
    expect(typeof drafts[0].id).toBe("string");
  });

  it("addDraft generates unique ids", () => {
    const store = useReviewDraftStore.getState();
    store.addDraft(PR_KEY, makeDraft());
    store.addDraft(PR_KEY, makeDraft({ body: "Another" }));
    const drafts = useReviewDraftStore.getState().getDrafts(PR_KEY);
    expect(drafts).toHaveLength(2);
    expect(drafts[0].id).not.toBe(drafts[1].id);
  });

  it("removeDraft removes a specific draft", () => {
    const store = useReviewDraftStore.getState();
    store.addDraft(PR_KEY, makeDraft({ body: "Keep" }));
    store.addDraft(PR_KEY, makeDraft({ body: "Remove" }));
    const drafts = useReviewDraftStore.getState().getDrafts(PR_KEY);
    const toRemove = drafts.find((d) => d.body === "Remove")!;
    useReviewDraftStore.getState().removeDraft(PR_KEY, toRemove.id);
    const remaining = useReviewDraftStore.getState().getDrafts(PR_KEY);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].body).toBe("Keep");
  });

  it("removeDraft cleans up key when last draft removed", () => {
    const store = useReviewDraftStore.getState();
    store.addDraft(PR_KEY, makeDraft());
    const drafts = useReviewDraftStore.getState().getDrafts(PR_KEY);
    useReviewDraftStore.getState().removeDraft(PR_KEY, drafts[0].id);
    expect(useReviewDraftStore.getState().getDrafts(PR_KEY)).toEqual([]);
    expect(useReviewDraftStore.getState().drafts[PR_KEY]).toBeUndefined();
  });

  it("updateDraft updates the body of a specific draft", () => {
    useReviewDraftStore.getState().addDraft(PR_KEY, makeDraft());
    const id = useReviewDraftStore.getState().getDrafts(PR_KEY)[0].id;
    useReviewDraftStore.getState().updateDraft(PR_KEY, id, "Updated body");
    const draft = useReviewDraftStore.getState().getDrafts(PR_KEY)[0];
    expect(draft.body).toBe("Updated body");
    expect(draft.id).toBe(id);
  });

  it("getDraftsForFile filters by path", () => {
    const store = useReviewDraftStore.getState();
    store.addDraft(PR_KEY, makeDraft({ path: "a.ts" }));
    store.addDraft(PR_KEY, makeDraft({ path: "b.ts" }));
    store.addDraft(PR_KEY, makeDraft({ path: "a.ts", line: 20 }));
    const forA = useReviewDraftStore
      .getState()
      .getDraftsForFile(PR_KEY, "a.ts");
    expect(forA).toHaveLength(2);
    expect(forA.every((d) => d.path === "a.ts")).toBe(true);
  });

  it("clearDrafts removes all drafts for a key", () => {
    const store = useReviewDraftStore.getState();
    store.addDraft(PR_KEY, makeDraft());
    store.addDraft(PR_KEY, makeDraft());
    store.clearDrafts(PR_KEY);
    expect(useReviewDraftStore.getState().getDrafts(PR_KEY)).toEqual([]);
  });

  it("different PR keys are independent", () => {
    const store = useReviewDraftStore.getState();
    store.addDraft(PR_KEY, makeDraft({ body: "PR 42" }));
    store.addDraft(PR_KEY_2, makeDraft({ body: "PR 99" }));
    expect(useReviewDraftStore.getState().getDrafts(PR_KEY)).toHaveLength(1);
    expect(useReviewDraftStore.getState().getDrafts(PR_KEY_2)).toHaveLength(1);
    useReviewDraftStore.getState().clearDrafts(PR_KEY);
    expect(useReviewDraftStore.getState().getDrafts(PR_KEY)).toHaveLength(0);
    expect(useReviewDraftStore.getState().getDrafts(PR_KEY_2)).toHaveLength(1);
  });

  it("supports reply drafts with replyToId", () => {
    useReviewDraftStore.getState().addDraft(
      PR_KEY,
      makeDraft({
        type: "reply",
        replyToId: 12345,
        body: "Replying to thread",
      }),
    );
    const drafts = useReviewDraftStore.getState().getDrafts(PR_KEY);
    expect(drafts[0].type).toBe("reply");
    expect(drafts[0].replyToId).toBe(12345);
  });

  it("supports startLine for multi-line drafts", () => {
    useReviewDraftStore
      .getState()
      .addDraft(PR_KEY, makeDraft({ line: 20, startLine: 15 }));
    const draft = useReviewDraftStore.getState().getDrafts(PR_KEY)[0];
    expect(draft.line).toBe(20);
    expect(draft.startLine).toBe(15);
  });
});
