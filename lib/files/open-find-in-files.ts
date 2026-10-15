import { useContentSearchStore } from "@/stores/content-search-store";
import { useEditorStore } from "@/stores/editor-store";

const MAX_PREFILL_LENGTH = 200;
const SEARCHABLE_INPUT_TYPES = new Set([
  "text",
  "search",
  "url",
  "email",
  "tel",
]);

// Relies on the global `Window.__devhubMonaco` declaration; importing
// lib/editor/* here would pull the editor stack into the root layout.
function readFocusedMonacoSelection(): string {
  const focusedEditor = window.__devhubMonaco?.editor
    .getEditors()
    .find((editor) => editor.hasTextFocus());
  const model = focusedEditor?.getModel();
  const selection = focusedEditor?.getSelection();
  return model && selection ? model.getValueInRange(selection) : "";
}

function readFormControlSelection(
  control: HTMLInputElement | HTMLTextAreaElement,
): string {
  const { selectionStart, selectionEnd, value } = control;
  if (selectionStart === null || selectionEnd === null) return "";
  if (selectionEnd <= selectionStart) return "";
  return value.slice(selectionStart, selectionEnd);
}

function readSelectedText(): string {
  const monacoText = readFocusedMonacoSelection();
  if (monacoText) return monacoText;

  const activeElement = document.activeElement;
  // Never surface a password, not even through the DOM selection fallback.
  if (activeElement instanceof HTMLInputElement) {
    if (!SEARCHABLE_INPUT_TYPES.has(activeElement.type)) return "";
    const inputText = readFormControlSelection(activeElement);
    if (inputText) return inputText;
  }
  if (activeElement instanceof HTMLTextAreaElement) {
    const textareaText = readFormControlSelection(activeElement);
    if (textareaText) return textareaText;
  }

  return window.getSelection()?.toString() ?? "";
}

export function getFindInFilesPrefill(): string | null {
  const selectedText = readSelectedText();
  if (!selectedText) return null;
  if (/[\r\n]/.test(selectedText)) return null;
  if (selectedText.length > MAX_PREFILL_LENGTH) return null;
  return selectedText;
}

export function openFindInFiles(input: {
  pathname: string;
  push: (href: string) => void;
}): void {
  useContentSearchStore.getState().requestOpen(getFindInFilesPrefill());
  useEditorStore.getState().setFileTreeOpen(true);
  if (input.pathname !== "/files") input.push("/files");
}
