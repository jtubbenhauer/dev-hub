import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MarkdownContent } from "@/components/chat/markdown-content";
import {
  parseFileLinkHref,
  resolveWorkspaceFilePath,
} from "@/components/chat/file-path-code";
import { openFileInSidePanel } from "@/lib/side-panel-open-file";

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => false,
}));

vi.mock("@/hooks/use-settings", () => ({
  useChatFileOpenSetting: () => ({
    fileOpenMode: "sidebar",
    isLoading: false,
  }),
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

vi.mock("@/lib/side-panel-open-file", () => ({
  openFileInSidePanel: vi.fn(),
}));

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
    vi.mocked(openFileInSidePanel).mockClear();
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
      "/files?open=docs%2Fopen-items.md",
    );
  });

  it("opens the file in the side panel instead of navigating", async () => {
    const anchor = renderSingleLink("[docs/open-items.md](docs/open-items.md)");
    await userEvent.click(anchor);
    expect(openFileInSidePanel).toHaveBeenCalledWith(
      "ws-1",
      "docs/open-items.md",
      expect.any(Function),
    );
  });

  it("links folders to the file tree", () => {
    const anchor = renderSingleLink("[chat](components/chat/)");
    expect(anchor.getAttribute("href")).toBe("/files?expand=components%2Fchat");
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
