import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, screen, waitFor } from "@testing-library/react";

import type { EditorRevealRequest } from "@/stores/editor-store";
import { useEditorStore } from "@/stores/editor-store";
import { useWorkbenchStore } from "@/stores/workbench-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import {
  createFileBuffer,
  fileTabParams,
  renderFileTabs,
  WORKSPACE_ID,
} from "./file-tab-fixtures";

interface MonacoStubProps {
  readonly filePath?: string;
  readonly revealRequest?: EditorRevealRequest | null;
  readonly onRevealHandled?: (id: number) => void;
}

const doubles = vi.hoisted(() => ({
  monacoProps: new Map<string, MonacoStubProps>(),
  registerAction: vi.fn(),
  deregisterAction: vi.fn(),
}));

vi.mock("@/components/editor/monaco-editor", () => ({
  MonacoEditor: (props: MonacoStubProps) => {
    doubles.monacoProps.set(props.filePath ?? "", props);
    return <div data-testid="monaco-editor" data-path={props.filePath} />;
  },
}));

vi.mock("@/hooks/use-git", () => ({
  useGitStatus: () => ({ data: undefined }),
}));

vi.mock("@/hooks/use-diagnostics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-diagnostics")>()),
  useLintOnSave: () => ({ lintFile: vi.fn(), isLinting: false }),
}));

vi.mock("@/components/providers/leader-key-provider", () => ({
  useLeaderKey: () => ({
    registerAction: doubles.registerAction,
    deregisterAction: doubles.deregisterAction,
  }),
}));

const REVEAL_IN_B: Omit<EditorRevealRequest, "id"> = {
  workspaceId: WORKSPACE_ID,
  path: "b.ts",
  lineNumber: 2,
  startColumn: 3,
  endColumn: 9,
  startByteColumn: 3,
  lineSha256: "a".repeat(64),
};

function revealRequestOf(path: string): EditorRevealRequest | null | undefined {
  return doubles.monacoProps.get(path)?.revealRequest;
}

beforeEach(() => {
  localStorage.clear();
  doubles.monacoProps.clear();
  useWorkbenchStore.setState(useWorkbenchStore.getInitialState(), true);
  useWorkspaceStore.setState({ activeWorkspaceId: WORKSPACE_ID });
  useEditorStore.setState({
    openFiles: [createFileBuffer("a.ts"), createFileBuffer("b.ts")],
    activeFilePath: null,
    pendingReveal: null,
    fileViewModes: {},
  });
});

afterEach(() => {
  cleanup();
});

describe("file tab reveal routing", () => {
  it("keeps a reveal for B pending while A's editor is mounted too", async () => {
    // Given
    renderFileTabs([
      { panelId: "tab-a", path: "a.ts" },
      { panelId: "tab-b", path: "b.ts", isBeside: true },
    ]);
    await waitFor(() =>
      expect(screen.getAllByTestId("monaco-editor")).toHaveLength(2),
    );

    // When
    act(() => useEditorStore.getState().requestReveal(REVEAL_IN_B));

    // Then
    expect(useEditorStore.getState().pendingReveal).toMatchObject(REVEAL_IN_B);
    expect(revealRequestOf("a.ts")).toBeNull();
    expect(revealRequestOf("b.ts")).toMatchObject(REVEAL_IN_B);
  });

  it("hands a reveal to the file tab that opens after it was requested", async () => {
    // Given
    const { api } = renderFileTabs([{ panelId: "tab-a", path: "a.ts" }]);
    await screen.findByTestId("monaco-editor");
    act(() => useEditorStore.getState().requestReveal(REVEAL_IN_B));

    // When
    act(() => {
      api.addPanel({
        id: "tab-b",
        component: "file",
        params: fileTabParams("b.ts"),
        title: "b.ts",
      });
    });

    // Then
    await waitFor(() =>
      expect(revealRequestOf("b.ts")).toMatchObject(REVEAL_IN_B),
    );
    expect(revealRequestOf("a.ts")).toBeNull();
  });

  it("clears the reveal once B's editor handled it", async () => {
    // Given
    renderFileTabs([
      { panelId: "tab-a", path: "a.ts" },
      { panelId: "tab-b", path: "b.ts", isBeside: true },
    ]);
    await waitFor(() =>
      expect(screen.getAllByTestId("monaco-editor")).toHaveLength(2),
    );
    act(() => useEditorStore.getState().requestReveal(REVEAL_IN_B));
    const request = revealRequestOf("b.ts");
    if (!request) throw new Error("B's editor never received the reveal");

    // When
    act(() => doubles.monacoProps.get("b.ts")?.onRevealHandled?.(request.id));

    // Then
    expect(useEditorStore.getState().pendingReveal).toBeNull();
  });
});
