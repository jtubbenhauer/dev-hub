import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// Captures the props the (mocked) MonacoReviewEditor was rendered with.
let capturedProps: Record<string, unknown> | undefined;

// next/dynamic → resolve the loader eagerly via React.lazy + Suspense so the
// mocked MonacoReviewEditor actually mounts under jsdom instead of the stub.
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

vi.mock("@/components/review/monaco-review-editor", () => ({
  MonacoReviewEditor: (props: Record<string, unknown>) => {
    capturedProps = props;
    return <div data-testid="monaco-review-editor" />;
  },
}));

const useGitFileContentMock = vi.fn();
const useGitFileContentAtRefMock = vi.fn();
vi.mock("@/hooks/use-git", () => ({
  useGitFileContent: (...args: unknown[]) => useGitFileContentMock(...args),
  useGitFileContentAtRef: (...args: unknown[]) =>
    useGitFileContentAtRefMock(...args),
}));

import { SidePanelDiffView } from "@/components/chat/side-panel-diff-view";

interface HookResult {
  data:
    | { original: string; current: string; path: string; language: string }
    | undefined;
  isLoading: boolean;
  isPlaceholderData: boolean;
  error: Error | null;
}

function mockHook(result: Partial<HookResult>) {
  useGitFileContentMock.mockReturnValue({
    data: undefined,
    isLoading: false,
    isPlaceholderData: false,
    error: null,
    ...result,
  });
}

function fileContent(path: string) {
  return {
    original: "const a = 1\n",
    current: "const a = 2\n",
    path,
    language: "typescript",
  };
}

beforeEach(() => {
  capturedProps = undefined;
  useGitFileContentMock.mockReset();
  useGitFileContentAtRefMock.mockReset();
  useGitFileContentAtRefMock.mockReturnValue({
    data: undefined,
    isLoading: false,
    isPlaceholderData: false,
    error: null,
  });
});

describe("SidePanelDiffView", () => {
  it("renders loading while the hook is loading", () => {
    mockHook({ isLoading: true });
    render(
      <SidePanelDiffView workspaceId="ws1" filePath="a.ts" staged={false} />,
    );
    expect(screen.getByTestId("diff-loading")).toBeInTheDocument();
    expect(
      screen.queryByTestId("monaco-review-editor"),
    ).not.toBeInTheDocument();
  });

  it("renders MonacoReviewEditor on success with read-only props", async () => {
    mockHook({ data: fileContent("a.ts") });
    render(
      <SidePanelDiffView workspaceId="ws1" filePath="a.ts" staged={false} />,
    );
    await screen.findByTestId("monaco-review-editor");
    expect(capturedProps?.showToolbar).toBe(false);
    expect(capturedProps?.forceSideBySide).toBe(true);
    expect(capturedProps?.readOnly).toBe(true);
    expect(capturedProps?.workspaceId).toBe("ws1");
    const passed = capturedProps?.fileContent as { path: string };
    expect(passed.path).toBe("a.ts");
  });

  it("shows loading (not the diff) on a rapid switch with placeholder data", () => {
    // keepPreviousData hands us the PREVIOUS file (a.ts) while we asked for b.ts.
    mockHook({ data: fileContent("a.ts"), isPlaceholderData: true });
    render(
      <SidePanelDiffView workspaceId="ws1" filePath="b.ts" staged={false} />,
    );
    expect(screen.getByTestId("diff-loading")).toBeInTheDocument();
    expect(
      screen.queryByTestId("monaco-review-editor"),
    ).not.toBeInTheDocument();
  });

  it("shows loading when data.path does not match filePath (placeholder false)", () => {
    mockHook({ data: fileContent("a.ts"), isPlaceholderData: false });
    render(
      <SidePanelDiffView workspaceId="ws1" filePath="b.ts" staged={false} />,
    );
    expect(screen.getByTestId("diff-loading")).toBeInTheDocument();
    expect(
      screen.queryByTestId("monaco-review-editor"),
    ).not.toBeInTheDocument();
  });

  it("renders an untracked (all-added) file without throwing", async () => {
    mockHook({
      data: {
        original: "",
        current: "const x = 1\n",
        path: "new.ts",
        language: "typescript",
      },
    });
    render(
      <SidePanelDiffView workspaceId="ws1" filePath="new.ts" staged={false} />,
    );
    await screen.findByTestId("monaco-review-editor");
    const passed = capturedProps?.fileContent as {
      original: string;
      current: string;
    };
    expect(passed.original).toBe("");
    expect(passed.current).toBe("const x = 1\n");
  });

  it("renders the error state when error is set AND data is undefined (error-first)", () => {
    mockHook({ error: new Error("boom"), data: undefined });
    render(
      <SidePanelDiffView workspaceId="ws1" filePath="a.ts" staged={false} />,
    );
    expect(screen.getByTestId("diff-error")).toHaveTextContent("boom");
    expect(screen.queryByTestId("diff-loading")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("monaco-review-editor"),
    ).not.toBeInTheDocument();
  });

  it("renders loading when data is undefined with no error (no crash)", () => {
    mockHook({ data: undefined, error: null });
    render(
      <SidePanelDiffView workspaceId="ws1" filePath="a.ts" staged={false} />,
    );
    expect(screen.getByTestId("diff-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("diff-error")).not.toBeInTheDocument();
  });

  it("uses the ref-based query (and disables the working query) when baseRef is set", async () => {
    mockHook({ data: fileContent("a.ts") });
    useGitFileContentAtRefMock.mockReturnValue({
      data: {
        original: "base\n",
        current: "branch\n",
        path: "a.ts",
        language: "typescript",
      },
      isLoading: false,
      isPlaceholderData: false,
      error: null,
    });
    render(
      <SidePanelDiffView workspaceId="ws1" filePath="a.ts" baseRef="main" />,
    );
    await screen.findByTestId("monaco-review-editor");
    expect(useGitFileContentAtRefMock).toHaveBeenCalledWith(
      "ws1",
      "a.ts",
      "main",
    );
    expect(useGitFileContentMock).toHaveBeenCalledWith(null, "a.ts", false);
    const passed = capturedProps?.fileContent as { original: string };
    expect(passed.original).toBe("base\n");
  });

  it("disables the ref-based query when baseRef is not set", () => {
    mockHook({ isLoading: true });
    render(<SidePanelDiffView workspaceId="ws1" filePath="a.ts" />);
    expect(useGitFileContentAtRefMock).toHaveBeenCalledWith(null, "a.ts", null);
  });
});
