import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";
import type * as Monaco from "monaco-editor";
import { useLspEditorAttachment } from "@/hooks/use-lsp-editor-attachment";
import { useMonacoEditorOptions } from "@/hooks/use-monaco-editor-options";
import { useLspEnabledSetting } from "@/hooks/use-settings";
import { useLspStore } from "@/stores/lsp-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { Workspace } from "@/types";

vi.mock("@/hooks/use-settings", () => ({ useLspEnabledSetting: vi.fn() }));
vi.mock("@/lib/lsp/client/lsp-session", () => ({
  registerLspMonacoInstance: vi.fn(),
}));

const workspace: Workspace = {
  id: "ws",
  userId: "user",
  name: "Workspace",
  path: "/Workspace",
  type: "repo",
  backend: "local",
  parentRepoPath: null,
  packageManager: null,
  quickCommands: null,
  provider: null,
  opencodeUrl: null,
  agentUrl: null,
  providerMeta: null,
  shellCommand: null,
  sshTarget: null,
  sshPath: null,
  worktreeSymlinks: null,
  linkedTaskId: null,
  linkedTaskMeta: null,
  color: null,
  createdAt: new Date(0),
  lastAccessedAt: new Date(0),
};

function setLspEnabled(isLspEnabled: boolean) {
  vi.mocked(useLspEnabledSetting).mockReturnValue({
    isLspEnabled,
    isLoading: false,
  });
}

type FoldingOptions = { foldingStrategy?: string };

// Mirrors Monaco: updateOptions merges and fires listeners synchronously only on change.
function createConfigurableEditor() {
  const rawOptions: FoldingOptions = { foldingStrategy: "indentation" };
  const listeners = new Set<() => void>();
  const updateOptions = vi.fn((next: FoldingOptions) => {
    if (
      next.foldingStrategy === undefined ||
      next.foldingStrategy === rawOptions.foldingStrategy
    )
      return;
    rawOptions.foldingStrategy = next.foldingStrategy;
    for (const listener of [...listeners]) listener();
  });
  const editor = {
    getModel: () => null,
    getContainerDomNode: () => document.createElement("div"),
    getRawOptions: () => ({ ...rawOptions }),
    updateOptions,
    onDidChangeModel: () => ({ dispose: () => undefined }),
    onDidChangeConfiguration: (listener: () => void) => {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
  };
  const reapplyWrapperOptions = () =>
    updateOptions({ foldingStrategy: "indentation" });
  return { editor, listeners, reapplyWrapperOptions };
}

function renderAttachment() {
  const fake = createConfigurableEditor();
  // Monaco cannot run in jsdom; the hook only touches these editor APIs here.
  const editorRef = {
    current: fake.editor as unknown as Monaco.editor.IStandaloneCodeEditor,
  };
  const monacoRef = { current: {} as unknown as typeof Monaco };
  const hook = renderHook(() => {
    const modelPath = useLspEditorAttachment({
      editorRef,
      monacoRef,
      isEditorReady: true,
      workspaceId: "ws",
      filePath: "src/a.ts",
      isLspEligible: true,
      content: "",
    });
    const options = useMonacoEditorOptions({
      fontSize: 14,
      tabSize: 2,
      isMobile: false,
      isCommentMode: true,
      modelPath,
      isCodeLensEnabled: false,
      isMinimapEnabled: true,
    });
    return { modelPath, options };
  });
  return { ...fake, hook };
}

describe("useLspEditorAttachment folding strategy", () => {
  beforeEach(() => {
    useLspStore.setState({ documentOwners: {} });
    useWorkspaceStore.setState({
      workspaces: [workspace],
      activeWorkspaceId: "ws",
    });
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("uses LSP folding ranges while the editor is attached", () => {
    setLspEnabled(true);
    const { editor, hook } = renderAttachment();
    expect(hook.result.current.modelPath).toBe("file:///Workspace/src/a.ts");
    expect(hook.result.current.options.foldingStrategy).toBe("auto");
    expect(editor.updateOptions).not.toHaveBeenCalled();
  });

  it("keeps the wrapper options identical across unrelated renders", () => {
    setLspEnabled(true);
    const { editor, hook, listeners } = renderAttachment();
    const options = hook.result.current.options;
    hook.rerender();
    expect(hook.result.current.options).toBe(options);
    expect(editor.updateOptions).not.toHaveBeenCalled();
    expect(listeners.size).toBe(0);
  });

  it("restores indentation folding and stops re-asserting when LSP detaches", () => {
    setLspEnabled(true);
    const { editor, hook, listeners } = renderAttachment();
    setLspEnabled(false);
    hook.rerender();
    expect(hook.result.current.modelPath).toBeUndefined();
    expect(hook.result.current.options.foldingStrategy).toBe("indentation");
    expect(editor.updateOptions).not.toHaveBeenCalled();
    expect(listeners.size).toBe(0);
  });

  it("drops the configuration listener on unmount", () => {
    setLspEnabled(true);
    const { hook, listeners } = renderAttachment();
    hook.unmount();
    expect(listeners.size).toBe(0);
  });
});
