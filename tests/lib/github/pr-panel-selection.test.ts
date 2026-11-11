import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  openPullRequestInDevHub,
  PR_PANEL_PATH,
  SELECTED_PR_STORAGE_KEY,
} from "@/lib/github/pr-panel-selection";

describe("openPullRequestInDevHub", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("stores the selection the PRs page opens on and navigates there", () => {
    localStorage.setItem("dev-hub:pr-selected-file", "src/old.ts");
    const navigate = vi.fn();

    openPullRequestInDevHub({ nameWithOwner: "acme/web", number: 7, navigate });

    expect(localStorage.getItem(SELECTED_PR_STORAGE_KEY)).toBe("acme/web/7");
    expect(localStorage.getItem("dev-hub:pr-selected-file")).toBeNull();
    expect(navigate).toHaveBeenCalledExactlyOnceWith(PR_PANEL_PATH);
  });
});
