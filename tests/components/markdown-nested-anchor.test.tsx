import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { MarkdownContent } from "@/components/chat/markdown-content";

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => false,
}));

vi.mock("@/stores/workspace-store", () => ({
  useWorkspaceStore: () => "ws-1",
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/lib/side-panel-open-file", () => ({
  openFileInSidePanel: vi.fn(),
}));

describe("MarkdownContent - nested anchor prevention", () => {
  it("does not nest <a> inside <a> when markdown link contains an inline code file path", () => {
    const { container } = render(
      <MarkdownContent content="See [`src/foo.ts`](https://example.com/foo)." />,
    );

    const anchors = container.querySelectorAll("a");
    for (const anchor of anchors) {
      expect(anchor.querySelector("a")).toBeNull();
    }
  });

  it("preserves outer link's href when inline code inside would otherwise become FilePathCode", () => {
    const { container } = render(
      <MarkdownContent content="See [`src/foo.ts`](https://example.com/foo)." />,
    );

    const anchor = container.querySelector("a");
    expect(anchor).not.toBeNull();
    expect(anchor?.getAttribute("href")).toBe("https://example.com/foo");
  });

  it("still renders FilePathCode for bare inline code file paths not inside a link", () => {
    const { container } = render(
      <MarkdownContent content="Edit `src/foo.ts` to fix this." />,
    );

    const anchors = container.querySelectorAll("a");
    expect(anchors).toHaveLength(1);
    expect(anchors[0].getAttribute("href")).toMatch(/\/files\?open=/);
  });
});
