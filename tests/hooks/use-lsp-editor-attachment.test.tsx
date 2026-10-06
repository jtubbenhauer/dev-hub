// allow: SIZE_OK — Task 12 requires the ownership and ordered attachment contract in this single suite.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, render, renderHook } from "@testing-library/react";
import { useEffect } from "react";
import type * as Monaco from "monaco-editor";
import {
  PREVIOUS_MODEL_DISPOSE_DELAY_MS,
  useLspEditorAttachment,
} from "@/hooks/use-lsp-editor-attachment";
import { useLspEnabledSetting } from "@/hooks/use-settings";
import { useLspStore } from "@/stores/lsp-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { registerLspMonacoInstance } from "@/lib/lsp/client/lsp-session";
import * as navigation from "@/lib/lsp/client/navigation-registry";
import { fakeModel } from "@/tests/lib/lsp/lsp-session-fixture";
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
const defaults = {
  workspaceId: "ws",
  filePath: "src/a.ts",
  isLspEligible: true,
  content: "tab text",
  isEditorReady: true,
};

function environment(surface = "files-page") {
  const order: string[] = [];
  const models = new Map<string, Monaco.editor.ITextModel>();
  const createModel = (uri: string, initialValue: string) => {
    let value = initialValue;
    let isDisposed = false;
    const model = Object.assign(fakeModel(uri), {
      uri: Object.assign(fakeModel(uri).uri, { scheme: uri.split(":")[0] }),
      getValue: () => value,
      setValue: vi.fn((next: string) => {
        value = next;
        order.push("setValue");
      }),
      isDisposed: () => isDisposed,
      dispose: vi.fn(() => {
        isDisposed = true;
      }),
    });
    models.set(uri, model);
    return model;
  };
  let currentModel = createModel("inmemory://model/1", "tab text");
  const container = document.createElement("div");
  container.setAttribute("data-lsp-surface", surface);
  const child = document.createElement("div");
  container.append(child);
  const listeners = new Set<
    (event: Monaco.editor.IModelChangedEvent) => void
  >();
  const subscriptionDispose = vi.fn();
  const editor = {
    getModel: () => currentModel,
    getContainerDomNode: () => child,
    updateOptions: vi.fn(),
    setPosition: vi.fn((_position: Monaco.IPosition) => {
      order.push("setPosition");
    }),
    revealPositionInCenter: vi.fn(),
    focus: vi.fn(),
    onDidChangeModel: (
      listener: (event: Monaco.editor.IModelChangedEvent) => void,
    ) => {
      listeners.add(listener);
      return {
        dispose: () => {
          listeners.delete(listener);
          subscriptionDispose();
        },
      };
    },
  };
  const monaco = {
    editor: {
      getModel: (uri: Monaco.Uri) => models.get(uri.toString()) ?? null,
      getEditors: () => [editor],
    },
  };
  const switchModel = (model: typeof currentModel) => {
    const oldModelUrl = currentModel.uri;
    currentModel = model;
    order.push("setModel");
    for (const listener of listeners)
      listener({ oldModelUrl, newModelUrl: model.uri });
    order.push("restoreViewState");
  };
  // Monaco's browser runtime cannot run in jsdom; these refs expose only the consumed editor APIs.
  const editorRef = {
    current: editor as unknown as Monaco.editor.IStandaloneCodeEditor,
  };
  const monacoRef = { current: monaco as unknown as typeof Monaco };
  return {
    editorRef,
    monacoRef,
    editor,
    monaco,
    createModel,
    switchModel,
    order,
    subscriptionDispose,
  };
}

function pending(
  surface: "files-page" | "split-panel",
  uri = "file:///workspace/src/a.ts",
) {
  return navigation.setPendingNavigation(surface, {
    uriKey: uri,
    lineNumber: 17,
    column: 4,
  });
}

describe("useLspEditorAttachment", () => {
  beforeEach(() => {
    vi.mocked(useLspEnabledSetting).mockReturnValue({
      isLspEnabled: true,
      isLoading: false,
    });
    useLspStore.setState({ documentOwners: {} });
    useWorkspaceStore.setState({
      workspaces: [workspace],
      activeWorkspaceId: "ws",
    });
  });
  afterEach(() => {
    cleanup();
    for (const surface of ["files-page", "split-panel"] as const) {
      navigation.clearPendingNavigation(surface, pending(surface));
    }
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it.each([
    "disabled",
    "not eligible",
    "remote",
    "non-active workspace",
    "markdown",
    "missing workspace",
    "missing path",
  ])("returns no path when %s", (condition) => {
    const fixture = environment();
    if (condition === "disabled")
      vi.mocked(useLspEnabledSetting).mockReturnValue({
        isLspEnabled: false,
        isLoading: false,
      });
    if (condition === "remote")
      useWorkspaceStore.setState({
        workspaces: [{ ...workspace, backend: "remote" }],
      });
    if (condition === "non-active workspace")
      useWorkspaceStore.setState({ activeWorkspaceId: "other" });
    if (condition === "missing workspace")
      useWorkspaceStore.setState({ workspaces: [] });
    const { result } = renderHook(() =>
      useLspEditorAttachment({
        ...defaults,
        ...fixture,
        isLspEligible: condition !== "not eligible",
        filePath:
          condition === "markdown"
            ? "README.md"
            : condition === "missing path"
              ? undefined
              : defaults.filePath,
      }),
    );

    expect(result.current).toBeUndefined();
    expect(useLspStore.getState().documentOwners).toEqual({});
    expect(registerLspMonacoInstance).not.toHaveBeenCalled();
    expect(fixture.editor.updateOptions).toHaveBeenLastCalledWith({
      "semanticHighlighting.enabled": "configuredByTheme",
    });
  });

  it.each(["a.ts", "my file.ts"])(
    "returns an encoded path only after claiming %s",
    (filename) => {
      const fixture = environment();
      const paths: (string | undefined)[] = [];
      const { result, unmount } = renderHook(() => {
        const path = useLspEditorAttachment({
          ...defaults,
          ...fixture,
          filePath: `src/${filename}`,
        });
        paths.push(path);
        return path;
      });

      expect(paths[0]).toBeUndefined();
      expect(result.current).toBe(
        `file:///Workspace/src/${encodeURIComponent(filename)}`,
      );
      expect(registerLspMonacoInstance).toHaveBeenCalledWith(
        fixture.monacoRef.current,
      );
      expect(fixture.editor.updateOptions).toHaveBeenLastCalledWith({
        "semanticHighlighting.enabled": true,
      });
      unmount();
      expect(useLspStore.getState().documentOwners).toEqual({});
    },
  );

  it("never binds both simultaneous mounts and retries when the owner unmounts", () => {
    const fixture = environment();
    const snapshots: (string | undefined)[][] = [];
    const latest = new Map<string, string | undefined>();
    function Attachment({ id }: { id: string }) {
      const path = useLspEditorAttachment({
        ...defaults,
        ...fixture,
        isEditorReady: false,
      });
      latest.set(id, path);
      snapshots.push([...latest.values()]);
      useEffect(
        () => () => {
          latest.delete(id);
        },
        [id],
      );
      return <span data-testid={id}>{path}</span>;
    }
    function Pair({ showFirst }: { showFirst: boolean }) {
      return (
        <>
          {showFirst && <Attachment key="first" id="first" />}
          <Attachment key="second" id="second" />
        </>
      );
    }
    const view = render(<Pair showFirst />);
    expect(view.getByTestId("first")).toHaveTextContent(
      "file:///Workspace/src/a.ts",
    );
    expect(view.getByTestId("second")).toBeEmptyDOMElement();

    view.rerender(<Pair showFirst={false} />);

    expect(view.getByTestId("second")).toHaveTextContent(
      "file:///Workspace/src/a.ts",
    );
    expect(snapshots.every((paths) => paths.filter(Boolean).length <= 1)).toBe(
      true,
    );
  });

  it.each(["disk", "tab text"])(
    "reconciles reused %s after child restore and before pending navigation",
    (existingValue) => {
      const fixture = environment();
      const target = fixture.createModel(
        "file:///Workspace/src/b.ts",
        existingValue,
      );
      function Child({ path }: { path: string | undefined }) {
        useEffect(() => {
          if (path === "file:///Workspace/src/b.ts")
            fixture.switchModel(target);
        }, [path]);
        return null;
      }
      function Parent({
        filePath,
        content,
      }: {
        filePath: string;
        content: string;
      }) {
        const path = useLspEditorAttachment({
          ...defaults,
          ...fixture,
          filePath,
          content,
        });
        return <Child path={path} />;
      }
      const view = render(<Parent filePath="src/a.ts" content="old tab" />);
      pending("files-page", "file:///workspace/src/b.ts");
      fixture.order.length = 0;

      view.rerender(<Parent filePath="src/b.ts" content="tab text" />);

      expect(target.getValue()).toBe("tab text");
      expect(fixture.order).toEqual([
        "setModel",
        "restoreViewState",
        ...(existingValue === "disk" ? ["setValue"] : []),
        "setPosition",
      ]);
      expect(target.setValue).toHaveBeenCalledTimes(
        existingValue === "disk" ? 1 : 0,
      );
      expect(fixture.editor.setPosition).toHaveBeenCalledWith({
        lineNumber: 17,
        column: 4,
      });
    },
  );

  it("disposes previous unshown file models without consuming pending in the model event", () => {
    vi.useFakeTimers();
    const fixture = environment();
    const old = fixture.createModel("file:///Workspace/src/old.ts", "old");
    fixture.switchModel(old);
    const { unmount } = renderHook(() =>
      useLspEditorAttachment({ ...defaults, ...fixture }),
    );
    const take = vi.spyOn(navigation, "takePendingNavigation");
    take.mockClear();
    const next = fixture.createModel("file:///Workspace/src/b.ts", "next");

    act(() => fixture.switchModel(next));

    expect(old.dispose).not.toHaveBeenCalled();
    expect(fixture.order.at(-1)).toBe("restoreViewState");
    act(() => vi.advanceTimersByTime(0));
    expect(old.dispose).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(PREVIOUS_MODEL_DISPOSE_DELAY_MS - 1));
    expect(old.dispose).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(old.dispose).toHaveBeenCalledOnce();
    expect(take).not.toHaveBeenCalled();
    unmount();
    expect(fixture.subscriptionDispose).toHaveBeenCalledOnce();
  });

  it("still disposes an unshown previous model when the hook unmounts before the delay", () => {
    vi.useFakeTimers();
    const fixture = environment();
    const old = fixture.createModel("file:///Workspace/src/old.ts", "old");
    fixture.switchModel(old);
    const { unmount } = renderHook(() =>
      useLspEditorAttachment({ ...defaults, ...fixture }),
    );
    act(() =>
      fixture.switchModel(fixture.createModel("inmemory://next", "next")),
    );

    unmount();
    act(() => vi.advanceTimersByTime(PREVIOUS_MODEL_DISPOSE_DELAY_MS));

    expect(old.dispose).toHaveBeenCalledOnce();
  });

  it("restarts the delay when a previous model is shown and left again", () => {
    vi.useFakeTimers();
    const fixture = environment();
    const first = fixture.createModel("file:///Workspace/src/first.ts", "a");
    const second = fixture.createModel("file:///Workspace/src/second.ts", "b");
    fixture.switchModel(first);
    renderHook(() => useLspEditorAttachment({ ...defaults, ...fixture }));
    act(() => fixture.switchModel(second));
    act(() => vi.advanceTimersByTime(PREVIOUS_MODEL_DISPOSE_DELAY_MS - 2));
    act(() => fixture.switchModel(first));
    act(() => fixture.switchModel(second));

    act(() => vi.advanceTimersByTime(2));

    expect(first.dispose).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(PREVIOUS_MODEL_DISPOSE_DELAY_MS));
    expect(first.dispose).toHaveBeenCalledOnce();
    expect(second.dispose).not.toHaveBeenCalled();
  });

  it.each(["attached", "disposed", "reshown", "replaced", "inmemory"])(
    "keeps the old model safe when %s before the delayed disposal",
    (condition) => {
      vi.useFakeTimers();
      const fixture = environment();
      const uri =
        condition === "inmemory"
          ? "inmemory://old"
          : "file:///Workspace/old.ts";
      const old = fixture.createModel(uri, "old");
      fixture.switchModel(old);
      renderHook(() => useLspEditorAttachment({ ...defaults, ...fixture }));
      const next = fixture.createModel("inmemory://next", "next");
      act(() => fixture.switchModel(next));
      expect(old.dispose).not.toHaveBeenCalled();
      switch (condition) {
        case "attached":
          vi.mocked(old.isAttachedToEditor).mockReturnValue(true);
          break;
        case "disposed":
          old.dispose();
          old.dispose.mockClear();
          break;
        case "reshown":
          act(() => fixture.switchModel(old));
          break;
        case "replaced":
          fixture.createModel(uri, "replacement");
          break;
        case "inmemory":
          break;
      }
      act(() => vi.advanceTimersByTime(PREVIOUS_MODEL_DISPOSE_DELAY_MS));
      expect(old.dispose).not.toHaveBeenCalled();
    },
  );

  it.each(["files-page", "split-panel"] as const)(
    "applies only split-panel pending when remounted ready five seconds after %s navigation",
    (surface) => {
      vi.useFakeTimers();
      const fixture = environment("split-panel");
      const target = fixture.createModel(
        "file:///Workspace/src/a.ts",
        "tab text",
      );
      fixture.switchModel(target);
      const previous = renderHook(() =>
        useLspEditorAttachment({ ...defaults, ...fixture }),
      );
      previous.unmount();
      pending(surface);
      act(() => vi.advanceTimersByTime(5000));
      const view = renderHook(
        ({ ready }) =>
          useLspEditorAttachment({
            ...defaults,
            ...fixture,
            isEditorReady: ready,
          }),
        { initialProps: { ready: false } },
      );
      fixture.editor.setPosition.mockClear();

      view.rerender({ ready: true });

      expect(fixture.editor.setPosition).toHaveBeenCalledTimes(
        surface === "split-panel" ? 1 : 0,
      );
      if (surface === "split-panel") {
        expect(fixture.editor.revealPositionInCenter).toHaveBeenCalledWith({
          lineNumber: 17,
          column: 4,
        });
        expect(fixture.editor.focus).toHaveBeenCalledOnce();
      } else {
        expect(
          navigation.takePendingNavigation(
            "files-page",
            "file:///workspace/src/a.ts",
          ),
        ).toEqual({ lineNumber: 17, column: 4 });
      }
    },
  );
});
