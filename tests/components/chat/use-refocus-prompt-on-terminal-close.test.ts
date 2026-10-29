import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRefocusPromptOnTerminalClose } from "@/components/chat/use-refocus-prompt-on-terminal-close";
import { useTerminalStore } from "@/stores/terminal-store";

describe("useRefocusPromptOnTerminalClose", () => {
  beforeEach(() => {
    useTerminalStore.setState({ isOpen: false });
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 0;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function renderWithPrompt() {
    const focus = vi.fn();
    const promptInputRef = { current: { focus } };
    const hook = renderHook(() =>
      useRefocusPromptOnTerminalClose(promptInputRef),
    );
    return { focus, ...hook };
  }

  it("focuses the prompt input when the terminal drawer closes", () => {
    const { focus } = renderWithPrompt();

    useTerminalStore.getState().setOpen(true);
    expect(focus).not.toHaveBeenCalled();

    useTerminalStore.getState().setOpen(false);
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it("focuses the prompt input when the drawer is toggled closed", () => {
    const { focus } = renderWithPrompt();

    useTerminalStore.getState().toggle();
    useTerminalStore.getState().toggle();

    expect(focus).toHaveBeenCalledTimes(1);
  });

  it("does not focus when the drawer opens or stays closed", () => {
    const { focus } = renderWithPrompt();

    useTerminalStore.getState().setOpen(false);
    useTerminalStore.getState().setOpen(true);

    expect(focus).not.toHaveBeenCalled();
  });

  it("stops listening after unmount", () => {
    const { focus, unmount } = renderWithPrompt();
    useTerminalStore.getState().setOpen(true);
    unmount();

    useTerminalStore.getState().setOpen(false);

    expect(focus).not.toHaveBeenCalled();
  });
});
