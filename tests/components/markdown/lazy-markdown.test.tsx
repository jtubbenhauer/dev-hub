import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  ChatMarkdownRenderer,
  GitHubMarkdownRenderer,
  TaskMarkdownRenderer,
} from "@/components/markdown/markdown-renderers";

const SAMPLE_MARKDOWN = [
  "# Title",
  "",
  "Some **bold** text and a [link](https://example.com).",
  "",
  "| a | b |",
  "|---|---|",
  "| 1 | 2 |",
  "",
  "```ts",
  "const answer: number = 42;",
  "```",
].join("\n");

// Fresh module state per test, so each test starts with the renderer unloaded.
async function importFreshLazyMarkdown() {
  vi.resetModules();
  return import("@/components/markdown/lazy-markdown");
}

describe("lazy markdown", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("shows the raw text in the prose container while the renderer loads", async () => {
    const { LazyGitHubMarkdown } = await importFreshLazyMarkdown();

    const { container } = render(
      <LazyGitHubMarkdown content="Some **bold** text" className="text-xs" />,
    );

    const fallback = container.querySelector("[data-markdown-loading]");
    expect(fallback).toHaveTextContent("Some **bold** text");
    expect(container.firstElementChild).toHaveClass("prose", "text-xs");
    expect(await screen.findByText("bold")).toHaveProperty("tagName", "STRONG");
    expect(container.querySelector("[data-markdown-loading]")).toBeNull();
  });

  it("renders the same GitHub markdown as the renderer once loaded", async () => {
    const { LazyGitHubMarkdown } = await importFreshLazyMarkdown();
    const expected = render(
      <GitHubMarkdownRenderer content={SAMPLE_MARKDOWN} className="text-xs" />,
    ).container.innerHTML;

    const { container } = render(
      <LazyGitHubMarkdown content={SAMPLE_MARKDOWN} className="text-xs" />,
    );

    await vi.waitFor(() => expect(container.innerHTML).toBe(expected));
  });

  it("renders the same chat markdown as the renderer once loaded", async () => {
    const { LazyChatMarkdown } = await importFreshLazyMarkdown();
    const expected = render(<ChatMarkdownRenderer content={SAMPLE_MARKDOWN} />)
      .container.innerHTML;

    const { container } = render(
      <LazyChatMarkdown content={SAMPLE_MARKDOWN} />,
    );

    await vi.waitFor(() => expect(container.innerHTML).toBe(expected));
  });

  it("renders the same task markdown as the renderer once loaded", async () => {
    const { LazyTaskMarkdown } = await importFreshLazyMarkdown();
    const expected = render(<TaskMarkdownRenderer content={SAMPLE_MARKDOWN} />)
      .container.innerHTML;

    const { container } = render(
      <LazyTaskMarkdown content={SAMPLE_MARKDOWN} />,
    );

    await vi.waitFor(() => expect(container.innerHTML).toBe(expected));
  });

  it("renders without the fallback when the renderer is already loaded", async () => {
    const { LazyChatMarkdown, preloadMarkdownRenderers } =
      await importFreshLazyMarkdown();
    await preloadMarkdownRenderers();

    const { container } = render(<LazyChatMarkdown content="Some **bold**" />);

    expect(container.querySelector("[data-markdown-loading]")).toBeNull();
    expect(screen.getByText("bold")).toHaveProperty("tagName", "STRONG");
  });

  it("renders nothing for empty GitHub markdown", async () => {
    const { LazyGitHubMarkdown } = await importFreshLazyMarkdown();

    const { container } = render(<LazyGitHubMarkdown content="" />);

    expect(container).toBeEmptyDOMElement();
  });
});
