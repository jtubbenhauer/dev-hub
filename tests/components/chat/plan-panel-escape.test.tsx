import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import {
  ChatTabProvider,
  type ChatTabContextValue,
} from "@/components/chat/chat-tab-context";
import { PlanPanel } from "@/components/chat/plan-panel";

vi.mock("@/components/editor/editor-switcher", () => ({
  EditorSwitcher: () => <div data-testid="plan-editor" />,
}));
vi.mock("@/components/editor/markdown-preview", () => ({
  MarkdownPreviewToggle: () => null,
}));

function chatTab(isFocused: boolean): ChatTabContextValue {
  return {
    tabId: "tab-1",
    workspaceId: "w1",
    sessionId: "s1",
    isFocused,
    isLastFocusedChat: isFocused,
    isVisible: true,
  };
}

async function renderOpenPlanPanel(wrap: (panel: ReactNode) => ReactNode) {
  const onClose = vi.fn();
  render(
    wrap(
      <PlanPanel
        workspaceId="w1"
        workspaceName="w1"
        isOpen
        onClose={onClose}
        onPlanFilesChange={vi.fn()}
      />,
    ),
  );
  // Waits for the plan file list so no load finishes after the test.
  await screen.findByText("No plan files found");
  return { onClose };
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ files: [] }))),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("PlanPanel Escape", () => {
  it("closes the plan panel of the focused chat tab", async () => {
    // Given
    const { onClose } = await renderOpenPlanPanel((panel) => (
      <ChatTabProvider value={chatTab(true)}>{panel}</ChatTabProvider>
    ));

    // When
    fireEvent.keyDown(window, { key: "Escape" });

    // Then
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("leaves the plan panel of an unfocused chat tab open", async () => {
    // Given
    const { onClose } = await renderOpenPlanPanel((panel) => (
      <ChatTabProvider value={chatTab(false)}>{panel}</ChatTabProvider>
    ));

    // When
    fireEvent.keyDown(window, { key: "Escape" });

    // Then
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes the plan panel outside chat tabs", async () => {
    // Given
    const { onClose } = await renderOpenPlanPanel((panel) => panel);

    // When
    fireEvent.keyDown(window, { key: "Escape" });

    // Then
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
