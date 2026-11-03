import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { preloadMarkdownRenderers } from "@/components/markdown/lazy-markdown";
import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MarkdownContent } from "@/components/chat/markdown-content";
import {
  parseFileLinkHref,
  resolveWorkspaceFilePath,
} from "@/components/chat/file-path-code";
import { openFileInWorkbench } from "@/lib/workbench/open-in-workbench";
import { createWorkbenchHref } from "@/lib/workbench/workbench-href";

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => false,
}));

vi.mock("@/hooks/use-settings", () => ({
  useChatFileOpenSetting: () => ({
    fileOpenMode: "sidebar",
    isLoading: false,
  }),
  useFileTabsSetting: () => ({ isFileTabsDisabled: false, isLoading: false }),
}));

vi.mock("@/stores/workspace-store", () => {
  const workspaceState = {
    activeWorkspaceId: "ws-1",
    workspaces: [{ id: "ws-1", path: "/repo", sshPath: null }],
  };
  return {
    useWorkspaceStore: (selector: (state: typeof workspaceState) => unknown) =>
      selector(workspaceState),
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/lib/workbench/open-in-workbench", () => ({
  openFileInWorkbench: vi.fn(async () => true),
}));

// The markdown renderer is lazy; load it once so renders are synchronous.
beforeAll(async () => {
  await preloadMarkdownRenderers();
});

function renderSingleLink(content: string): HTMLAnchorElement {
  const { container } = render(<MarkdownContent content={content} />);
  const anchors = container.querySelectorAll("a");
  expect(anchors).toHaveLength(1);
  return anchors[0];
}

describe("parseFileLinkHref", () => {
  it.each([
    ["docs/open-items.md", "docs/open-items.md"],
    ["./docs/open-items.md", "./docs/open-items.md"],
    ["file:///repo/docs/open-items.md", "/repo/docs/open-items.md"],
    ["open-items.md:12", "open-items.md"],
    ["docs/open-items.md:12:3", "docs/open-items.md"],
    ["docs/open-items.md#L4-L9", "docs/open-items.md"],
    ["docs/open%20items.md", "docs/open items.md"],
    ["components/chat/", "components/chat/"],
  ])("parses %s", (href, expected) => {
    expect(parseFileLinkHref(href)).toBe(expected);
  });

  it.each([
    "https://example.com/readme.md",
    "mailto:someone@example.com",
    "javascript:alert(1)",
    "javascript:foo.md:1",
    "#section",
    "",
  ])("rejects %s", (href) => {
    expect(parseFileLinkHref(href)).toBeNull();
  });
});

describe("resolveWorkspaceFilePath", () => {
  it("keeps relative paths, stripping a leading ./", () => {
    expect(resolveWorkspaceFilePath("./docs/a.md", ["/repo"])).toBe(
      "docs/a.md",
    );
  });

  it("makes absolute paths inside a workspace root relative", () => {
    expect(resolveWorkspaceFilePath("/repo/docs/a.md", ["/repo/"])).toBe(
      "docs/a.md",
    );
  });

  it("returns null for absolute paths outside every workspace root", () => {
    expect(resolveWorkspaceFilePath("/repo-other/a.md", ["/repo"])).toBeNull();
  });
});

describe("MarkdownContent - file links", () => {
  beforeEach(() => {
    vi.mocked(openFileInWorkbench).mockClear();
  });

  it.each([
    ["[docs/open-items.md](docs/open-items.md)"],
    ["[`docs/open-items.md`](docs/open-items.md)"],
    ["[open items](file:///repo/docs/open-items.md)"],
    ["[open items](/repo/docs/open-items.md#L4)"],
    ["[open items](docs/open-items.md:12)"],
  ])("renders %s as an editor link", (content) => {
    const anchor = renderSingleLink(content);
    expect(anchor.getAttribute("href")).toBe(
      createWorkbenchHref({
        open: "file",
        workspaceId: "ws-1",
        path: "docs/open-items.md",
      }),
    );
  });

  it("opens the file as a workbench tab instead of navigating", async () => {
    const anchor = renderSingleLink("[docs/open-items.md](docs/open-items.md)");
    await userEvent.click(anchor);
    expect(openFileInWorkbench).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        workspaceId: "ws-1",
        path: "docs/open-items.md",
        isFileTabsDisabled: false,
      }),
    );
  });

  it("links folders to the workbench explorer", () => {
    const anchor = renderSingleLink("[chat](components/chat/)");
    expect(anchor.getAttribute("href")).toBe(
      createWorkbenchHref({
        open: "folder",
        workspaceId: "ws-1",
        path: "components/chat",
      }),
    );
  });

  it("leaves external links untouched", () => {
    const anchor = renderSingleLink("[spec](https://example.com/spec.md)");
    expect(anchor.getAttribute("href")).toBe("https://example.com/spec.md");
  });

  it("leaves absolute paths outside the workspace as plain links", () => {
    const anchor = renderSingleLink("[notes](/elsewhere/notes.md)");
    expect(anchor.getAttribute("href")).toBe("/elsewhere/notes.md");
  });

  it("still sanitises unsafe protocols", () => {
    const anchor = renderSingleLink("[bad](javascript:alert(1))");
    expect(anchor.getAttribute("href") ?? "").not.toContain("javascript");
  });
});
