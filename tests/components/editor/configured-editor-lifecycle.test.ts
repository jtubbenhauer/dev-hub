import { describe, expect, it, vi } from "vitest";
import { registerConfiguredEditorCleanup } from "@/components/editor/configured-editor-lifecycle";

describe("configured editor child ownership", () => {
  it("disposes only the unowned sibling with this editor's exact context", () => {
    const context = {};
    const children = new Set<unknown>();
    const parent = { _children: children };
    const own = { _parent: parent, dispose: vi.fn() };
    const leaked = {
      _services: { _entries: new Map([["contextKeyService", context]]) },
      dispose: vi.fn(),
    };
    const foreign = {
      _services: { _entries: new Map([["contextKeyService", {}]]) },
      dispose: vi.fn(),
    };
    children.add(own).add(leaked).add(foreign);
    let dispose = () => {};
    const instance = {
      _instantiationService: own,
      _contextKeyService: context,
      onDidDispose: (callback: () => void) => {
        dispose = callback;
        return { dispose: vi.fn() };
      },
    };
    registerConfiguredEditorCleanup(instance);
    dispose();
    expect(leaked.dispose).toHaveBeenCalledOnce();
    expect(own.dispose).not.toHaveBeenCalled();
    expect(foreign.dispose).not.toHaveBeenCalled();
  });
  it("accepts public-only editors without touching shared services", () => {
    const instance = { onDidDispose: vi.fn() };
    expect(() => registerConfiguredEditorCleanup(instance)).not.toThrow();
  });
});
