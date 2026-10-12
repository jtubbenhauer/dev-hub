import type * as Monaco from "monaco-editor";
import type { OpenEditor } from "@codingame/monaco-vscode-editor-service-override";
import { vi } from "vitest";

export function workspaceUri(relativePath: string): string {
  return `file:///Workspace/${relativePath}`;
}

export function fakeResource(uri: string): Monaco.Uri {
  // Only URI stringification is exercised; never load Monaco's runtime in jsdom.
  return { toString: () => uri } as unknown as Monaco.Uri;
}

export function createFakeEditor(container: HTMLElement, uri: string | null) {
  let modelUri = uri;
  const modelListeners = new Set<() => void>();
  const disposeListeners = new Set<() => void>();
  const listen = (listeners: Set<() => void>) => (listener: () => void) => {
    listeners.add(listener);
    return { dispose: () => listeners.delete(listener) };
  };
  const setSelection = vi.fn();
  const revealRangeInCenter = vi.fn();
  const focus = vi.fn();
  // The fake implements only the editor APIs the navigation code consumes.
  const editor = {
    getContainerDomNode: () => container,
    getModel: () =>
      modelUri === null ? null : { uri: fakeResource(modelUri) },
    setSelection,
    revealRangeInCenter,
    focus,
    onDidChangeModel: listen(modelListeners),
    onDidDispose: listen(disposeListeners),
  } as unknown as Monaco.editor.ICodeEditor;
  return {
    editor,
    setSelection,
    revealRangeInCenter,
    focus,
    showUri(nextUri: string | null) {
      modelUri = nextUri;
      for (const listener of [...modelListeners]) listener();
    },
    fireDispose() {
      for (const listener of [...disposeListeners]) listener();
    },
  };
}

export function buildSurface(name: string | null) {
  const surface = document.createElement("div");
  if (name !== null) surface.setAttribute("data-lsp-surface", name);
  const container = document.createElement("div");
  const outerMonacoEditor = document.createElement("div");
  outerMonacoEditor.className = "monaco-editor";
  const peekContainer = document.createElement("div");
  const focusTarget = document.createElement("textarea");
  outerMonacoEditor.append(focusTarget, peekContainer);
  container.append(outerMonacoEditor);
  surface.append(container);
  return { surface, container, peekContainer, focusTarget };
}

export function mountSurface(name: string | null) {
  const elements = buildSurface(name);
  document.body.append(elements.surface);
  return elements;
}

export function createModelRef(uri: string) {
  const dispose = vi.fn();
  const ref = {
    object: { textEditorModel: { uri: fakeResource(uri) } },
    dispose,
  } as unknown as Parameters<OpenEditor>[0];
  return { ref, dispose };
}

export function selectionOptions(
  startLineNumber: number,
  startColumn: number,
  endColumn: number,
) {
  return {
    preserveFocus: false,
    selection: {
      startLineNumber,
      startColumn,
      endLineNumber: startLineNumber,
      endColumn,
    },
  };
}

export function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}
