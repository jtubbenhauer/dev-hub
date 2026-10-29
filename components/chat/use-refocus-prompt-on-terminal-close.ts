import { useEffect, type RefObject } from "react";
import { useTerminalStore } from "@/stores/terminal-store";

interface FocusableInput {
  focus: () => void;
}

export function useRefocusPromptOnTerminalClose(
  promptInputRef: RefObject<FocusableInput | null>,
) {
  useEffect(
    () =>
      useTerminalStore.subscribe((state, previousState) => {
        if (!previousState.isOpen || state.isOpen) return;
        // Wait a frame so the drawer's terminal unmounts before we take focus.
        requestAnimationFrame(() => promptInputRef.current?.focus());
      }),
    [promptInputRef],
  );
}
