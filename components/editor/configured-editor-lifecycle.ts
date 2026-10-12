import type { editor } from "monaco-editor";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function registerConfiguredEditorCleanup(
  instance: Pick<editor.ICodeEditor, "onDidDispose">,
): void {
  const internal: unknown = instance;
  if (!isRecord(internal)) return;
  const own = internal._instantiationService;
  const context = internal._contextKeyService;
  if (!isRecord(own) || !isRecord(context)) return;
  const parent = own._parent;
  if (!isRecord(parent) || !(parent._children instanceof Set)) return;

  // @codingame 25.1.2 monaco.js creates an unregistered sibling for ResourceContextKey.
  // Match the exact scoped context; never dispose the shared parent or another editor's child.
  for (const child of parent._children) {
    if (
      child === own ||
      !isRecord(child) ||
      typeof child.dispose !== "function"
    )
      continue;
    const services = child._services;
    if (!isRecord(services) || !(services._entries instanceof Map)) continue;
    if (![...services._entries.values()].includes(context)) continue;
    const dispose = child.dispose.bind(child);
    instance.onDidDispose(() => dispose());
  }
}
