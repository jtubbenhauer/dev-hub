import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  parseFirebasePreviewComment,
  type FirebasePreview,
} from "@/lib/firebase-preview";

describe("parseFirebasePreviewComment", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("parses standard Firebase Hosting comment correctly", () => {
    const commentBody = `Visit the preview URL for this PR (updated for commit 350da47):

 https://principle-dev--pr5892-fix-api-docs-stack-o-vernseo6.web.app

(expires Wed, 25 Mar 2026 09:27:46 GMT)

🔥 via Firebase Hosting GitHub Action 🌎

Sign: 173ce2659407333f5196a326c2e2f0a9234d6ac6`;

    const commentUpdatedAt = "2026-03-22T10:00:00Z";
    const result = parseFirebasePreviewComment(commentBody, commentUpdatedAt);

    expect(result).not.toBeNull();
    expect(result!.url).toBe(
      "https://principle-dev--pr5892-fix-api-docs-stack-o-vernseo6.web.app",
    );
    expect(result!.commitSha).toBe("350da47");
    expect(result!.expiresAt).toEqual(
      new Date("Wed, 25 Mar 2026 09:27:46 GMT"),
    );
    expect(result!.deployedAt).toEqual(new Date(commentUpdatedAt));
  });

  it("returns null for non-Firebase comments", () => {
    const commentBody = "This is a regular PR comment without Firebase marker";
    const commentUpdatedAt = "2026-03-22T10:00:00Z";
    const result = parseFirebasePreviewComment(commentBody, commentUpdatedAt);

    expect(result).toBeNull();
  });

  it("returns null if Firebase marker exists but no URL found", () => {
    const commentBody = `Some text with Firebase Hosting GitHub Action marker
but no actual preview URL`;
    const commentUpdatedAt = "2026-03-22T10:00:00Z";
    const result = parseFirebasePreviewComment(commentBody, commentUpdatedAt);

    expect(result).toBeNull();
  });

  it("returns null if Firebase marker exists but no commit SHA found", () => {
    const commentBody = `Visit the preview URL for this PR:

 https://principle-dev--pr5892-fix-api-docs-stack-o-vernseo6.web.app

🔥 via Firebase Hosting GitHub Action 🌎`;
    const commentUpdatedAt = "2026-03-22T10:00:00Z";
    const result = parseFirebasePreviewComment(commentBody, commentUpdatedAt);

    expect(result).toBeNull();
  });

  it("marks preview as expired when expiry date is in the past", () => {
    vi.setSystemTime(new Date("2026-03-26T10:00:00Z"));

    const commentBody = `Visit the preview URL for this PR (updated for commit 350da47):

 https://principle-dev--pr5892-fix-api-docs-stack-o-vernseo6.web.app

(expires Wed, 25 Mar 2026 09:27:46 GMT)

🔥 via Firebase Hosting GitHub Action 🌎`;

    const commentUpdatedAt = "2026-03-22T10:00:00Z";
    const result = parseFirebasePreviewComment(commentBody, commentUpdatedAt);

    expect(result).not.toBeNull();
    expect(result!.isExpired).toBe(true);
  });

  it("marks preview as active when expiry date is in the future", () => {
    vi.setSystemTime(new Date("2026-03-24T10:00:00Z"));

    const commentBody = `Visit the preview URL for this PR (updated for commit 350da47):

 https://principle-dev--pr5892-fix-api-docs-stack-o-vernseo6.web.app

(expires Wed, 25 Mar 2026 09:27:46 GMT)

🔥 via Firebase Hosting GitHub Action 🌎`;

    const commentUpdatedAt = "2026-03-22T10:00:00Z";
    const result = parseFirebasePreviewComment(commentBody, commentUpdatedAt);

    expect(result).not.toBeNull();
    expect(result!.isExpired).toBe(false);
  });

  it("handles missing expiry date gracefully", () => {
    const commentBody = `Visit the preview URL for this PR (updated for commit 350da47):

 https://principle-dev--pr5892-fix-api-docs-stack-o-vernseo6.web.app

🔥 via Firebase Hosting GitHub Action 🌎`;

    const commentUpdatedAt = "2026-03-22T10:00:00Z";
    const result = parseFirebasePreviewComment(commentBody, commentUpdatedAt);

    expect(result).not.toBeNull();
    expect(result!.expiresAt).toBeNull();
    expect(result!.isExpired).toBe(false);
  });

  it("extracts first .web.app URL when multiple URLs present", () => {
    const commentBody = `Visit the preview URL for this PR (updated for commit 350da47):

 https://principle-dev--pr5892-fix-api-docs-stack-o-vernseo6.web.app

Also check: https://another-site--pr5892-other-site-abc123.web.app

(expires Wed, 25 Mar 2026 09:27:46 GMT)

🔥 via Firebase Hosting GitHub Action 🌎`;

    const commentUpdatedAt = "2026-03-22T10:00:00Z";
    const result = parseFirebasePreviewComment(commentBody, commentUpdatedAt);

    expect(result).not.toBeNull();
    expect(result!.url).toBe(
      "https://principle-dev--pr5892-fix-api-docs-stack-o-vernseo6.web.app",
    );
  });

  it("handles .firebaseapp.com domain", () => {
    const commentBody = `Visit the preview URL for this PR (updated for commit abc1234):

 https://my-project-pr123-xyz.firebaseapp.com

(expires Thu, 26 Mar 2026 10:00:00 GMT)

🔥 via Firebase Hosting GitHub Action 🌎`;

    const commentUpdatedAt = "2026-03-22T10:00:00Z";
    const result = parseFirebasePreviewComment(commentBody, commentUpdatedAt);

    expect(result).not.toBeNull();
    expect(result!.url).toBe("https://my-project-pr123-xyz.firebaseapp.com");
    expect(result!.commitSha).toBe("abc1234");
  });

  it("sets deployedAt to commentUpdatedAt timestamp", () => {
    const commentBody = `Visit the preview URL for this PR (updated for commit 350da47):

 https://principle-dev--pr5892-fix-api-docs-stack-o-vernseo6.web.app

(expires Wed, 25 Mar 2026 09:27:46 GMT)

🔥 via Firebase Hosting GitHub Action 🌎`;

    const commentUpdatedAt = "2026-03-22T15:30:45Z";
    const result = parseFirebasePreviewComment(commentBody, commentUpdatedAt);

    expect(result).not.toBeNull();
    expect(result!.deployedAt).toEqual(new Date(commentUpdatedAt));
  });

  it("returns correct FirebasePreview shape", () => {
    const commentBody = `Visit the preview URL for this PR (updated for commit 350da47):

 https://principle-dev--pr5892-fix-api-docs-stack-o-vernseo6.web.app

(expires Wed, 25 Mar 2026 09:27:46 GMT)

🔥 via Firebase Hosting GitHub Action 🌎`;

    const commentUpdatedAt = "2026-03-22T10:00:00Z";
    const result = parseFirebasePreviewComment(commentBody, commentUpdatedAt);

    expect(result).not.toBeNull();
    const preview = result as FirebasePreview;
    expect(preview).toHaveProperty("url");
    expect(preview).toHaveProperty("commitSha");
    expect(preview).toHaveProperty("expiresAt");
    expect(preview).toHaveProperty("isExpired");
    expect(preview).toHaveProperty("deployedAt");
    expect(typeof preview.url).toBe("string");
    expect(typeof preview.commitSha).toBe("string");
    expect(typeof preview.isExpired).toBe("boolean");
    expect(preview.deployedAt instanceof Date).toBe(true);
  });
});
