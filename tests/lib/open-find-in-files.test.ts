import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getFindInFilesPrefill,
  openFindInFiles,
} from "@/lib/files/open-find-in-files";
import { useContentSearchStore } from "@/stores/content-search-store";
import { useEditorStore } from "@/stores/editor-store";

interface FakeMonacoEditor {
  hasTextFocus: () => boolean;
  getModel: () => { getValueInRange: (range: unknown) => string } | null;
  getSelection: () => { startLineNumber: number } | null;
}

function installFakeMonaco(editors: FakeMonacoEditor[]) {
  Object.defineProperty(window, "__devhubMonaco", {
    configurable: true,
    writable: true,
    value: { editor: { getEditors: () => editors } },
  });
}

function fakeEditor(input: {
  isFocused: boolean;
  selectedText: string;
}): FakeMonacoEditor {
  return {
    hasTextFocus: () => input.isFocused,
    getModel: () => ({ getValueInRange: () => input.selectedText }),
    getSelection: () => ({ startLineNumber: 1 }),
  };
}

function selectDomText(text: string) {
  const paragraph = document.createElement("p");
  paragraph.textContent = text;
  document.body.appendChild(paragraph);
  const range = document.createRange();
  range.selectNodeContents(paragraph);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function focusFormControl(input: {
  element: HTMLInputElement | HTMLTextAreaElement;
  value: string;
  start: number;
  end: number;
}) {
  document.body.appendChild(input.element);
  input.element.value = input.value;
  input.element.focus();
  input.element.setSelectionRange(input.start, input.end);
}

beforeEach(() => {
  useContentSearchStore.setState({
    pattern: "",
    sidebarView: "explorer",
    pendingFocus: false,
  });
  useEditorStore.setState({ isFileTreeOpen: false });
});

afterEach(() => {
  Reflect.deleteProperty(window, "__devhubMonaco");
  window.getSelection()?.removeAllRanges();
  document.body.innerHTML = "";
});

describe("getFindInFilesPrefill", () => {
  it("returns the DOM selection text", () => {
    // Given
    selectDomText("useContentSearch");

    // When
    const prefill = getFindInFilesPrefill();

    // Then
    expect(prefill).toBe("useContentSearch");
  });

  it("prefers the selection of the focused Monaco editor", () => {
    // Given
    selectDomText("domText");
    installFakeMonaco([
      fakeEditor({ isFocused: false, selectedText: "unfocused" }),
      fakeEditor({ isFocused: true, selectedText: "monacoSelection" }),
    ]);

    // When
    const prefill = getFindInFilesPrefill();

    // Then
    expect(prefill).toBe("monacoSelection");
  });

  it("uses the selected text of a focused textarea", () => {
    // Given
    focusFormControl({
      element: document.createElement("textarea"),
      value: "fix the parser please",
      start: 8,
      end: 14,
    });

    // When
    const prefill = getFindInFilesPrefill();

    // Then
    expect(prefill).toBe("parser");
  });

  it("never reads the selection of a focused password input", () => {
    // Given
    const passwordInput = document.createElement("input");
    passwordInput.type = "password";
    focusFormControl({
      element: passwordInput,
      value: "hunter2secret",
      start: 0,
      end: 7,
    });

    // When
    const prefill = getFindInFilesPrefill();

    // Then
    expect(prefill).toBeNull();
  });

  it("returns null for a multi-line selection", () => {
    // Given
    focusFormControl({
      element: document.createElement("textarea"),
      value: "first line\nsecond line",
      start: 0,
      end: 16,
    });

    // When
    const prefill = getFindInFilesPrefill();

    // Then
    expect(prefill).toBeNull();
  });

  it("returns null for a selection longer than 200 characters", () => {
    // Given
    selectDomText("x".repeat(201));

    // When
    const prefill = getFindInFilesPrefill();

    // Then
    expect(prefill).toBeNull();
  });

  it("returns null when nothing is selected", () => {
    // Given nothing selected

    // When
    const prefill = getFindInFilesPrefill();

    // Then
    expect(prefill).toBeNull();
  });
});

describe("openFindInFiles", () => {
  it("requests the search view with the prefill", () => {
    // Given
    selectDomText("needle");

    // When
    openFindInFiles({ pathname: "/files", push: vi.fn() });

    // Then
    const state = useContentSearchStore.getState();
    expect(state.pattern).toBe("needle");
    expect(state.sidebarView).toBe("search");
    expect(state.pendingFocus).toBe(true);
  });

  it("opens the file tree sidebar", () => {
    // Given the file tree is closed

    // When
    openFindInFiles({ pathname: "/files", push: vi.fn() });

    // Then
    expect(useEditorStore.getState().isFileTreeOpen).toBe(true);
  });

  it("navigates to /files from another page", () => {
    // Given
    const push = vi.fn();

    // When
    openFindInFiles({ pathname: "/chat", push });

    // Then
    expect(push).toHaveBeenCalledWith("/files");
  });

  it("does not navigate when already on /files", () => {
    // Given
    const push = vi.fn();

    // When
    openFindInFiles({ pathname: "/files", push });

    // Then
    expect(push).not.toHaveBeenCalled();
  });
});
