import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FilesActiveEditor } from "@/components/editor/files-active-editor";
import { useEditorStore } from "@/stores/editor-store";

vi.mock("@/components/editor/editor-switcher", () => ({
  EditorSwitcher: ({ content }: { content: string }) => (
    <div data-testid="content">{content}</div>
  ),
}));
afterEach(cleanup);

describe("active editor content subscription", () => {
  it("renders external store content changes without re-rendering its parent", () => {
    useEditorStore.setState({
      openFiles: [
        {
          path: "a.ts",
          name: "a.ts",
          language: "typescript",
          content: "base",
          originalContent: "base",
          isDirty: false,
        },
      ],
      activeFilePath: "a.ts",
    });
    const parentRender = vi.fn();
    function Parent() {
      parentRender();
      return (
        <FilesActiveEditor
          filePath="a.ts"
          language="typescript"
          onChange={() => {}}
        />
      );
    }
    render(<Parent />);
    parentRender.mockClear();
    act(() =>
      useEditorStore.setState((state) => ({
        openFiles: state.openFiles.map((file) => ({
          ...file,
          content: "disk reload",
          originalContent: "disk reload",
        })),
      })),
    );
    expect(screen.getByTestId("content")).toHaveTextContent("disk reload");
    expect(parentRender).not.toHaveBeenCalled();
  });
});
