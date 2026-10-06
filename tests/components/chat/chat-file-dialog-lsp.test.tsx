import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ChatFileDialog } from "@/components/chat/chat-file-dialog";
import { useChatFileDialogStore } from "@/stores/chat-file-dialog-store";

vi.mock("@/components/editor/editor-switcher", () => ({
  EditorSwitcher: ({ isLspEligible }: { isLspEligible?: boolean }) => (
    <div data-testid="editor" data-eligible={String(isLspEligible)} />
  ),
}));

describe("ChatFileDialog LSP eligibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useChatFileDialogStore.getState().reset();
  });
  afterEach(cleanup);
  it("passes eligibility without a cross-file surface when showing a real file", () => {
    useChatFileDialogStore.setState({
      isOpen: true,
      isLoading: false,
      originalContent: "text",
      file: {
        workspaceId: "ws",
        path: "a.ts",
        content: "text",
        language: "typescript",
      },
    });

    render(<ChatFileDialog />);

    expect(screen.getByTestId("editor")).toHaveAttribute(
      "data-eligible",
      "true",
    );
    expect(
      screen.getByTestId("editor").closest("[data-lsp-surface]"),
    ).toBeNull();
  });
});
