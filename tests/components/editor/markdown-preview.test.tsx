import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  MarkdownPreviewFrame,
  MarkdownPreviewToggle,
} from "@/components/editor/markdown-preview";
import { stripFrontmatter } from "@/lib/file-preview";
import { useEditorStore } from "@/stores/editor-store";

function FileView({
  content,
  language,
  filePath,
}: {
  content: string;
  language: string;
  filePath?: string;
}) {
  return (
    <div>
      <div data-testid="header">
        <MarkdownPreviewToggle language={language} filePath={filePath} />
      </div>
      <MarkdownPreviewFrame
        content={content}
        language={language}
        filePath={filePath}
      >
        <div data-testid="fake-editor">editor</div>
      </MarkdownPreviewFrame>
    </div>
  );
}

describe("markdown preview", () => {
  beforeEach(() => {
    useEditorStore.getState().setMarkdownPreviewPath(null);
  });

  it("adds no toggle to the header for non-markdown files", () => {
    render(<FileView content="x" language="typescript" filePath="a.ts" />);
    expect(screen.getByTestId("header")).toBeEmptyDOMElement();
    expect(screen.getByTestId("fake-editor")).toBeInTheDocument();
  });

  it("shows the toggle in the header and defaults to edit mode", () => {
    render(<FileView content="# Title" language="markdown" filePath="a.md" />);
    expect(
      screen.getByRole("button", { name: "Preview markdown" }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("markdown-preview")).not.toBeInTheDocument();
  });

  it("toggles to a rendered preview and back, keeping the editor mounted", async () => {
    const user = userEvent.setup();
    render(
      <FileView
        content={"# Title\n\nSome **bold** text"}
        language="markdown"
        filePath="a.md"
      />,
    );

    await user.click(screen.getByRole("button", { name: "Preview markdown" }));
    const preview = screen.getByTestId("markdown-preview");
    expect(preview.querySelector("h1")?.textContent).toBe("Title");
    expect(screen.getByText("bold").tagName).toBe("STRONG");
    expect(screen.getByTestId("fake-editor")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Edit markdown" }));
    expect(screen.queryByTestId("markdown-preview")).not.toBeInTheDocument();
  });

  it("returns to edit mode when a different file is opened", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <FileView content="# One" language="markdown" filePath="one.md" />,
    );
    await user.click(screen.getByRole("button", { name: "Preview markdown" }));
    expect(screen.getByTestId("markdown-preview")).toBeInTheDocument();

    rerender(
      <FileView content="# Two" language="markdown" filePath="two.md" />,
    );
    expect(screen.queryByTestId("markdown-preview")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Preview markdown" }),
    ).toBeInTheDocument();
  });

  it("does not render YAML frontmatter in the preview", async () => {
    const user = userEvent.setup();
    render(
      <FileView
        content={"---\ntitle: Secret\n---\n# Body"}
        language="markdown"
        filePath="a.md"
      />,
    );
    await user.click(screen.getByRole("button", { name: "Preview markdown" }));
    const preview = screen.getByTestId("markdown-preview");
    expect(preview.textContent).not.toContain("title: Secret");
    expect(preview.querySelector("h1")?.textContent).toBe("Body");
  });
});

describe("stripFrontmatter", () => {
  it("removes a leading frontmatter block", () => {
    expect(stripFrontmatter("---\na: 1\n---\nbody")).toBe("body");
  });

  it("leaves content without frontmatter untouched", () => {
    expect(stripFrontmatter("# Hi\n---\nnot: fm\n---")).toBe(
      "# Hi\n---\nnot: fm\n---",
    );
  });
});
