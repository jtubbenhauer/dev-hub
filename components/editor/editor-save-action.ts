import type { editor } from "monaco-editor";

export function registerEditorSaveAction(
  instance: Pick<editor.IStandaloneCodeEditor, "addAction" | "onDidDispose">,
  keybinding: number,
  save: () => void,
): () => void {
  const action = instance.addAction({
    id: "devhub.saveFile",
    label: "Save file",
    keybindings: [keybinding],
    run: () => save(),
  });
  let isDisposed = false;
  const dispose = () => {
    if (isDisposed) return;
    isDisposed = true;
    action.dispose();
    subscription.dispose();
  };
  const subscription = instance.onDidDispose(dispose);
  return dispose;
}
