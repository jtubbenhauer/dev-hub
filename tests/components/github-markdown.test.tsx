import { render, screen } from "@testing-library/react";
import { GitHubMarkdown } from "@/components/git/github-markdown";

describe("GitHubMarkdown", () => {
  it("renders bold markdown text", () => {
    render(<GitHubMarkdown content="This is **bold** text" />);
    const bold = screen.getByText("bold");
    expect(bold.tagName).toBe("STRONG");
  });

  it("renders inline code", () => {
    render(<GitHubMarkdown content="Use `console.log()` here" />);
    const code = screen.getByText("console.log()");
    expect(code.tagName).toBe("CODE");
  });

  it("renders fenced code blocks", () => {
    const content = "```typescript\nconst x = 1;\n```";
    const { container } = render(<GitHubMarkdown content={content} />);
    const pre = container.querySelector("pre");
    expect(pre).toBeInTheDocument();
    expect(container.querySelector("code")).toBeInTheDocument();
  });

  it("strips HTML comments from output", () => {
    const content =
      '<!-- metadata:{"confidence":9} -->\nP2: Terminal validation is weak';
    const { container } = render(<GitHubMarkdown content={content} />);
    expect(container.textContent).not.toContain("metadata");
    expect(container.textContent).not.toContain("confidence");
    expect(screen.getByText(/Terminal validation is weak/)).toBeInTheDocument();
  });

  it("renders <details>/<summary> as real HTML elements", () => {
    const content = [
      "<details>",
      "<summary>Click to expand</summary>",
      "",
      "Hidden content here",
      "</details>",
    ].join("\n");
    const { container } = render(<GitHubMarkdown content={content} />);
    const details = container.querySelector("details");
    expect(details).toBeInTheDocument();
    const summary = container.querySelector("summary");
    expect(summary).toBeInTheDocument();
    expect(summary).toHaveTextContent("Click to expand");
  });

  it("renders GFM tables", () => {
    const content = [
      "| Name | Value |",
      "|------|-------|",
      "| foo  | bar   |",
    ].join("\n");
    const { container } = render(<GitHubMarkdown content={content} />);
    expect(container.querySelector("table")).toBeInTheDocument();
    expect(container.querySelector("th")).toHaveTextContent("Name");
    expect(container.querySelector("td")).toHaveTextContent("foo");
  });

  it("renders unordered lists", () => {
    const content = "- item one\n- item two\n- item three";
    const { container } = render(<GitHubMarkdown content={content} />);
    const items = container.querySelectorAll("li");
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent("item one");
  });

  it("renders links", () => {
    render(<GitHubMarkdown content="Visit [GitHub](https://github.com)" />);
    const link = screen.getByRole("link", { name: "GitHub" });
    expect(link).toHaveAttribute("href", "https://github.com");
  });

  it("handles empty string without crashing", () => {
    const { container } = render(<GitHubMarkdown content="" />);
    expect(container.firstChild).toBeNull();
  });

  it("applies custom className", () => {
    const { container } = render(
      <GitHubMarkdown content="hello" className="text-xs" />,
    );
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain("text-xs");
    expect(wrapper.className).toContain("prose");
  });

  it("renders complex GitHub PR comment with mixed content", () => {
    const content = [
      '<!-- metadata:{"confidence":9} -->',
      "P2: Terminal request validation is too weak.",
      "",
      "<details>",
      "<summary>Prompt for AI agents</summary>",
      "",
      "```text",
      "Check if this issue is valid",
      "```",
      "",
      "</details>",
    ].join("\n");

    const { container } = render(<GitHubMarkdown content={content} />);

    // metadata comment should be stripped
    expect(container.textContent).not.toContain("metadata");

    // main text should be visible
    expect(container.textContent).toContain(
      "Terminal request validation is too weak",
    );

    // details/summary should render
    expect(container.querySelector("details")).toBeInTheDocument();
    expect(container.querySelector("summary")).toHaveTextContent(
      "Prompt for AI agents",
    );

    // code block should render
    expect(container.querySelector("pre")).toBeInTheDocument();
  });
});
