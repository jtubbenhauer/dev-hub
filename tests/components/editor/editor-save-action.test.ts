import { describe, expect, it, vi } from "vitest";
import type { editor } from "monaco-editor";
import { registerEditorSaveAction } from "@/components/editor/editor-save-action";

describe("editor save action", () => {
  it("saves through the latest callback and unregisters on editor disposal", () => {
    let action: editor.IActionDescriptor | undefined;
    let onDispose = () => {};
    const disposeAction = vi.fn();
    const disposeListener = vi.fn();
    const instance = {
      addAction: (next: editor.IActionDescriptor) => {
        action = next;
        return { dispose: disposeAction };
      },
      onDidDispose: (callback: () => void) => {
        onDispose = callback;
        return { dispose: disposeListener };
      },
    };
    const save = vi.fn();
    const dispose = registerEditorSaveAction(instance, 2048 | 49, save);
    expect(action?.keybindings).toEqual([2048 | 49]);
    Reflect.apply(action?.run ?? (() => {}), undefined, []);
    expect(save).toHaveBeenCalledOnce();
    onDispose();
    dispose();
    expect(disposeAction).toHaveBeenCalledOnce();
    expect(disposeListener).toHaveBeenCalledOnce();
  });
});
