import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MoveToFileDialog } from "@/components/lsp/move-to-file-dialog";
import { useLspDialogStore } from "@/stores/lsp-dialog-store";

const session = vi.hoisted(() => ({ root: vi.fn<() => string | null>() }));
vi.mock("@/lib/lsp/client/lsp-session-registry", () => ({
  getActiveLspWorkspaceRoot: session.root,
}));

beforeEach(() => {
  session.root.mockReturnValue("/Workspace");
});
afterEach(() => {
  act(() => useLspDialogStore.getState().close(null));
  cleanup();
});

function openDialog() {
  render(<MoveToFileDialog />);
  let result: Promise<string | null> = Promise.resolve(null);
  act(() => {
    result = useLspDialogStore.getState().open();
  });
  return {
    result,
    user: userEvent.setup(),
    input: screen.getByRole("textbox", {
      name: "Target file (workspace-relative)",
    }),
  };
}

describe("Move to file dialog", () => {
  it.each([
    ["", "Enter a target file."],
    ["   ", "Enter a target file."],
    ["../other.ts", 'Target file must not contain "..".'],
    ["src/../other.ts", 'Target file must not contain "..".'],
    ["notes.md", "Choose a TypeScript or JavaScript file"],
    ["/outside.ts", "Use a workspace-relative path."],
    ["C:\\outside.ts", "Use a workspace-relative path."],
  ])(
    "rejects target %j with an accessible validation message",
    async (path, message) => {
      const { user, input } = openDialog();
      if (path) await user.type(input, path);
      await user.click(screen.getByRole("button", { name: "Move" }));
      expect(screen.getByRole("alert")).toHaveTextContent(message);
      expect(input).toHaveAttribute("aria-invalid", "true");
      expect(input).toHaveAccessibleDescription(
        new RegExp(message.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      );
      expect(useLspDialogStore.getState().request).not.toBeNull();
    },
  );

  it.each([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"])(
    "returns an absolute path when a %s target is confirmed",
    async (extension) => {
      session.root.mockReturnValue("/Workspace/");
      const { user, input, result } = openDialog();
      await user.type(input, `src/moved${extension}`);
      await user.click(screen.getByRole("button", { name: "Move" }));
      await expect(result).resolves.toBe(`/Workspace/src/moved${extension}`);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    },
  );

  it.each(["Cancel", "Close"])(
    "resolves null when %s is clicked",
    async (name) => {
      const { user, result } = openDialog();
      await user.click(screen.getByRole("button", { name }));
      await expect(result).resolves.toBeNull();
    },
  );

  it("resolves null when Escape dismisses the dialog", async () => {
    const { user, result } = openDialog();
    await user.keyboard("{Escape}");
    await expect(result).resolves.toBeNull();
  });

  it("submits the target when Enter is pressed", async () => {
    const { user, input, result } = openDialog();
    await user.type(input, "src/keyboard.ts{Enter}");
    await expect(result).resolves.toBe("/Workspace/src/keyboard.ts");
  });

  it("refuses confirmation when the session root is unavailable", async () => {
    session.root.mockReturnValue(null);
    const { user, input } = openDialog();
    await user.type(input, "src/moved.ts");
    await user.click(screen.getByRole("button", { name: "Move" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "No active LSP workspace.",
    );
  });

  it("cancels the first request when another request replaces it", async () => {
    const { result } = openDialog();
    let second: Promise<string | null> = Promise.resolve(null);
    act(() => {
      second = useLspDialogStore.getState().open();
    });
    await expect(result).resolves.toBeNull();
    act(() => useLspDialogStore.getState().close("/Workspace/second.ts"));
    await expect(second).resolves.toBe("/Workspace/second.ts");
  });

  it("starts with an empty field when reopened after cancellation", async () => {
    const { user, input } = openDialog();
    await user.type(input, "src/previous.ts");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    act(() => {
      void useLspDialogStore.getState().open();
    });
    expect(screen.getByRole("textbox")).toHaveValue("");
  });
});
