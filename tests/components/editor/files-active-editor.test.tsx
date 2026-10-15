import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FilesActiveEditor } from "@/components/editor/files-active-editor";
import {
  useEditorStore,
  type EditorRevealRequest,
} from "@/stores/editor-store";

const switcher = vi.hoisted(() =>
  vi.fn<
    (props: {
      readonly content: string;
      readonly revealRequest?: EditorRevealRequest | null;
      readonly onRevealHandled?: (id: number) => void;
    }) => void
  >(),
);

vi.mock("@/components/editor/editor-switcher", () => ({
  EditorSwitcher: (props: {
    content: string;
    revealRequest?: EditorRevealRequest | null;
    onRevealHandled?: (id: number) => void;
  }) => {
    switcher(props);
    return <div data-testid="content">{props.content}</div>;
  },
}));
afterEach(() => {
  cleanup();
  useEditorStore.setState({ pendingReveal: null });
  switcher.mockClear();
});

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

describe("active editor reveal routing", () => {
  const request: EditorRevealRequest = {
    id: 1,
    workspaceId: "ws",
    path: "a.ts",
    lineNumber: 2,
    startColumn: 3,
    endColumn: 9,
    startByteColumn: 3,
    lineSha256: "a".repeat(64),
  };
  const props = {
    filePath: "a.ts",
    workspaceId: "ws",
    language: "typescript",
    onChange: vi.fn(),
  };

  it.each([{ path: "b.ts" }, { workspaceId: "other" }])(
    "passes null when the request differs by %j",
    (override) => {
      // Given
      useEditorStore.setState({ pendingReveal: { ...request, ...override } });
      // When
      render(<FilesActiveEditor {...props} />);
      // Then
      expect(
        switcher.mock.calls.every(([value]) => value.revealRequest === null),
      ).toBe(true);
    },
  );

  it("passes the request and stable clear action when the file matches", () => {
    // Given
    useEditorStore.setState({ pendingReveal: request });
    // When
    render(<FilesActiveEditor {...props} />);
    // Then
    expect(switcher).toHaveBeenLastCalledWith(
      expect.objectContaining({
        revealRequest: request,
        onRevealHandled: useEditorStore.getState().clearReveal,
      }),
    );
  });

  it.each([{ filePath: "b.ts" }, { workspaceId: "other" }])(
    "clears a pending request when the active editor changes %j",
    (override) => {
      // Given
      useEditorStore.setState({ pendingReveal: request });
      const view = render(<FilesActiveEditor {...props} />);
      // When
      view.rerender(<FilesActiveEditor {...props} {...override} />);
      // Then
      expect(useEditorStore.getState().pendingReveal).toBeNull();
      expect(switcher).toHaveBeenLastCalledWith(
        expect.objectContaining({ revealRequest: null }),
      );
    },
  );
});
