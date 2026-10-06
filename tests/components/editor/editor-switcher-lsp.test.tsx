import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { lazy, Suspense, type ComponentType, type ReactNode } from "react";
import { EditorSwitcher } from "@/components/editor/editor-switcher";
import { useEditorTypeSetting } from "@/hooks/use-settings";

const { monaco, neovim } = vi.hoisted(() => ({
  monaco: vi.fn((_props: object) => null),
  neovim: vi.fn((_props: object) => null),
}));
vi.mock("@/components/editor/monaco-editor", () => ({ MonacoEditor: monaco }));
vi.mock("@/components/editor/neovim-editor", () => ({ NeovimEditor: neovim }));
vi.mock("@/hooks/use-settings", () => ({ useEditorTypeSetting: vi.fn() }));
vi.mock("@/components/editor/markdown-preview", () => ({
  MarkdownPreviewFrame: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/components/editor/csv-preview", () => ({
  CsvPreviewFrame: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("next/dynamic", () => ({
  default: (load: () => Promise<ComponentType>) => {
    const Component = lazy(async () => ({ default: await load() }));
    return function Dynamic(props: object) {
      return (
        <Suspense>
          <Component {...props} />
        </Suspense>
      );
    };
  },
}));

describe("EditorSwitcher LSP eligibility", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);
  it.each(["monaco", "neovim"] as const)(
    "forwards eligibility only to Monaco when using %s",
    async (editorType) => {
      vi.mocked(useEditorTypeSetting).mockReturnValue({
        editorType,
        isLoading: false,
      });

      render(
        <EditorSwitcher
          content="text"
          language="typescript"
          onChange={() => {}}
          isLspEligible
        />,
      );

      const selected = editorType === "monaco" ? monaco : neovim;
      await waitFor(() => expect(selected).toHaveBeenCalled());
      const props = selected.mock.calls.at(-1)?.[0];
      if (editorType === "monaco")
        expect(props).toHaveProperty("isLspEligible", true);
      else expect(props).not.toHaveProperty("isLspEligible");
    },
  );
});
