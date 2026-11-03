import { useEffect } from "react";
import { toggleWorkbenchContextSidebar } from "@/components/workbench/toggle-workbench-context-sidebar";
import { useWorkbenchChordsSetting } from "@/hooks/use-settings";
import {
  getWorkbenchController,
  type WorkbenchCommand,
} from "@/lib/workbench/workbench-controller-registry";
import {
  isEditableChordTarget,
  matchWorkbenchChord,
  type ChordKeyEvent,
  type WorkbenchChord,
} from "@/lib/workbench/workbench-shortcuts";

function assertNever(value: never): never {
  throw new Error(`Unhandled workbench chord: ${JSON.stringify(value)}`);
}

function runWorkbenchCommand(command: WorkbenchCommand): void {
  getWorkbenchController()?.runCommand(command);
}

function runChord(chord: WorkbenchChord): void {
  switch (chord.type) {
    case "next-tab":
      runWorkbenchCommand({ type: "cycle", direction: "next" });
      return;
    case "prev-tab":
      runWorkbenchCommand({ type: "cycle", direction: "previous" });
      return;
    case "focus-tab-number":
      runWorkbenchCommand({ type: "focus-number", n: chord.number });
      return;
    case "focus-group":
      runWorkbenchCommand({ type: "focus-group", direction: chord.direction });
      return;
    case "split-right":
      runWorkbenchCommand({ type: "split", direction: "right" });
      return;
    case "toggle-context-sidebar":
      toggleWorkbenchContextSidebar();
      return;
    default:
      assertNever(chord);
  }
}

function withoutRepeat(event: KeyboardEvent): ChordKeyEvent {
  return {
    code: event.code,
    ctrlKey: event.ctrlKey,
    altKey: event.altKey,
    shiftKey: event.shiftKey,
    metaKey: event.metaKey,
    isComposing: event.isComposing,
    repeat: false,
  };
}

// Keeps the key from the focused terminal or editor and from later listeners.
function swallowKey(event: KeyboardEvent): void {
  event.preventDefault();
  event.stopImmediatePropagation();
}

function handleChordKeyDown(event: KeyboardEvent): void {
  const chord = matchWorkbenchChord(event);
  if (chord === null) {
    // A held split or sidebar chord must not reach a terminal (Ctrl+\ = SIGQUIT).
    if (event.repeat && matchWorkbenchChord(withoutRepeat(event)) !== null) {
      swallowKey(event);
    }
    return;
  }
  // Alt+digit types characters (macOS Option), so text fields keep it.
  if (
    chord.type === "focus-tab-number" &&
    isEditableChordTarget(event.target)
  ) {
    return;
  }
  swallowKey(event);
  runChord(chord);
}

// Capture phase on window, so a focused xterm or Monaco never sees a chord.
export function useWorkbenchChords(): void {
  const { isEnabled } = useWorkbenchChordsSetting();

  useEffect(() => {
    if (!isEnabled) return;
    window.addEventListener("keydown", handleChordKeyDown, { capture: true });
    return () =>
      window.removeEventListener("keydown", handleChordKeyDown, {
        capture: true,
      });
  }, [isEnabled]);
}
