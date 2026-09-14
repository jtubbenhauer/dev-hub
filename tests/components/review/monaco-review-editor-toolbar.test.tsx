import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";

// Captured surfaces populated by the mocked DiffEditor on mount.
let capturedOptions: Record<string, unknown> | undefined;
let capturedSaveHandler: (() => void) | undefined;
let addCommandSpy: ReturnType<typeof vi.fn>;

function makeFakeModifiedEditor() {
  return {
    addCommand: addCommandSpy,
    createDecorationsCollection: vi.fn(() => ({
      set: vi.fn(),
      clear: vi.fn(),
    })),
    onMouseDown: vi.fn(),
    onDidScrollChange: vi.fn(),
    getModel: vi.fn(() => ({
      getLineCount: () => 1,
      getValue: () => "new",
      setValue: vi.fn(),
      getLineContent: () => "",
    })),
    updateOptions: vi.fn(),
    getValue: () => "new",
    focus: vi.fn(),
    getDomNode: () => ({
      getBoundingClientRect: () => ({ height: 500 }),
      blur: vi.fn(),
    }),
    getScrolledVisiblePosition: () => ({ top: 0, height: 10 }),
    revealLineInCenter: vi.fn(),
  };
}

const fakeMonaco = {
  KeyMod: { CtrlCmd: 2048 },
  KeyCode: { KeyS: 49 },
  editor: { MouseTargetType: { GUTTER_GLYPH_MARGIN: 5 } },
};

// next/dynamic → resolve the loader eagerly via React.lazy + Suspense so the
// mocked DiffEditor actually mounts under jsdom instead of the loading stub.
vi.mock("next/dynamic", () => ({
  __esModule: true,
  default: (
    loader: () => Promise<React.ComponentType<Record<string, unknown>>>,
  ) => {
    const Lazy = React.lazy(async () => ({ default: await loader() }));
    return function DynamicComponent(props: Record<string, unknown>) {
      return (
        <React.Suspense fallback={null}>
          <Lazy {...props} />
        </React.Suspense>
      );
    };
  },
}));

// Mocked DiffEditor: captures the options object and drives onMount with a
// fake editor whose addCommand surface is spyable.
vi.mock("@monaco-editor/react", () => ({
  DiffEditor: (props: {
    options?: Record<string, unknown>;
    onMount?: (editor: unknown, monaco: unknown) => void;
  }) => {
    capturedOptions = props.options;
    React.useEffect(() => {
      const modifiedEditor = makeFakeModifiedEditor();
      const diffEditor = {
        getModifiedEditor: () => modifiedEditor,
        getOriginalEditor: () => ({ updateOptions: vi.fn() }),
      };
      props.onMount?.(diffEditor, fakeMonaco);
    }, []);
    return <div data-testid="diff-editor" />;
  },
}));

vi.mock("@/lib/editor/monaco-themes", () => ({
  registerMonacoThemes: vi.fn(),
  getMonacoThemeName: () => "vs-dark",
  MONACO_FONT_FAMILY: "monospace",
}));

vi.mock("@/components/providers/theme-provider", () => ({
  useTheme: () => ({ theme: "system", resolvedMode: "dark" }),
}));

vi.mock("@/components/editor/diff-view-toggle", () => ({
  DiffViewToggle: () => <div data-testid="diff-view-toggle" />,
}));

vi.mock("@/hooks/use-settings", () => ({
  useFontSizeSetting: () => ({ fontSize: 14 }),
  useMobileFontSizeSetting: () => ({ mobileFontSize: 12 }),
  useTabSizeSetting: () => ({ tabSize: 2 }),
}));

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => false,
}));

vi.mock("@/hooks/use-file-comments", () => ({
  useFileComments: () => ({ data: [] }),
  useCreateFileComment: () => ({ mutate: vi.fn() }),
  useResolveFileComment: () => ({ mutate: vi.fn() }),
  useDeleteFileComment: () => ({ mutate: vi.fn() }),
  useUpdateFileComment: () => ({ mutate: vi.fn() }),
}));

vi.mock("@/stores/chat-store", () => ({
  useChatStore: (
    selector: (state: { activeSessionId: string | null }) => unknown,
  ) => selector({ activeSessionId: null }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
  Promise.resolve({ ok: true, json: () => Promise.resolve({}) }),
);
vi.stubGlobal("fetch", fetchMock);

import { MonacoReviewEditor } from "@/components/review/monaco-review-editor";
import { useEditorStore } from "@/stores/editor-store";

function makeFileContent(path = "lib/deep/nested/component.tsx") {
  return { original: "old", current: "new", path, language: "typescript" };
}

async function renderEditor(
  props: Partial<React.ComponentProps<typeof MonacoReviewEditor>> = {},
) {
  const result = render(
    <MonacoReviewEditor
      fileContent={makeFileContent()}
      workspaceId="ws-1"
      isLoading={false}
      {...props}
    />,
  );
  await waitFor(() => {
    expect(screen.getByTestId("diff-editor")).toBeInTheDocument();
  });
  return result;
}

describe("MonacoReviewEditor toolbar / forceSideBySide / readOnly props", () => {
  beforeEach(() => {
    capturedOptions = undefined;
    capturedSaveHandler = undefined;
    addCommandSpy = vi.fn((_keybinding: number, handler: () => void) => {
      capturedSaveHandler = handler;
    });
    fetchMock.mockClear();
    act(() => {
      useEditorStore.setState({ diffViewMode: "unified" });
    });
  });

  it("shows the file basename in the toolbar by default", async () => {
    await renderEditor();
    expect(screen.getByText("component.tsx")).toBeInTheDocument();
    expect(screen.queryByText("lib/deep/nested/component.tsx")).toBeNull();
  });

  it("renders no toolbar when showToolbar={false} while the editor still mounts", async () => {
    await renderEditor({ showToolbar: false });
    expect(screen.getByTestId("diff-editor")).toBeInTheDocument();
    expect(screen.queryByText("component.tsx")).toBeNull();
    // Negative control: the Save button must NOT exist without the toolbar.
    expect(screen.queryByText("Save")).toBeNull();
  });

  it("forces renderSideBySide=true when forceSideBySide even if global mode is unified", async () => {
    act(() => {
      useEditorStore.setState({ diffViewMode: "unified" });
    });
    await renderEditor({ forceSideBySide: true });
    expect(capturedOptions?.renderSideBySide).toBe(true);
  });

  it("preserves renderSideBySide=false default when unset and mode is unified", async () => {
    act(() => {
      useEditorStore.setState({ diffViewMode: "unified" });
    });
    await renderEditor();
    expect(capturedOptions?.renderSideBySide).toBe(false);
  });

  it("sets DiffEditor options readOnly=true when readOnly", async () => {
    await renderEditor({ readOnly: true });
    expect(capturedOptions?.readOnly).toBe(true);
  });

  it("keeps DiffEditor options readOnly=false by default", async () => {
    await renderEditor();
    expect(capturedOptions?.readOnly).toBe(false);
  });

  it("does NOT register the save command in readOnly, and never triggers a save fetch", async () => {
    await renderEditor({ readOnly: true });
    // Save keybinding is never registered at mount.
    expect(addCommandSpy).not.toHaveBeenCalled();
    expect(capturedSaveHandler).toBeUndefined();
    // Nothing to trigger — no write path fires.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("registers the save command and issues a PUT when not readOnly", async () => {
    await renderEditor();
    await waitFor(() => {
      expect(addCommandSpy).toHaveBeenCalled();
    });
    expect(capturedSaveHandler).toBeTypeOf("function");

    await act(async () => {
      capturedSaveHandler?.();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/files/content");
    expect(init?.method).toBe("PUT");
  });
});
