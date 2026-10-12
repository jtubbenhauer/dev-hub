"use client";

import { useId, useState, type SubmitEvent } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getActiveLspWorkspaceRoot } from "@/lib/lsp/client/lsp-session-registry";
import { LSP_DOCUMENT_EXTENSIONS } from "@/lib/lsp/types";
import { useLspDialogStore } from "@/stores/lsp-dialog-store";

export function MoveToFileDialog() {
  const isOpen = useLspDialogStore((state) => state.request !== null);
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  const errorId = `${inputId}-error`;

  function close(path: string | null) {
    setError(null);
    useLspDialogStore.getState().close(path);
  }

  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = new FormData(event.currentTarget).get("target");
    const path = typeof value === "string" ? value.trim() : "";
    if (!path) {
      setError("Enter a target file.");
      return;
    }
    if (path.includes("..")) {
      setError('Target file must not contain "..".');
      return;
    }
    if (
      path.startsWith("/") ||
      path.includes("\\") ||
      /^[a-z]:/i.test(path) ||
      path.includes("\0")
    ) {
      setError("Use a workspace-relative path.");
      return;
    }
    if (
      !LSP_DOCUMENT_EXTENSIONS.some((extension) =>
        path.toLowerCase().endsWith(extension),
      )
    ) {
      setError(
        `Choose a TypeScript or JavaScript file (${LSP_DOCUMENT_EXTENSIONS.join(", ")}).`,
      );
      return;
    }
    const workspaceRoot = getActiveLspWorkspaceRoot();
    if (workspaceRoot === null) {
      setError("No active LSP workspace.");
      return;
    }
    close(`${workspaceRoot.replace(/\/+$/, "")}/${path}`);
  }

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(isOpen) => {
        if (!isOpen) close(null);
      }}
    >
      <DialogContent>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <DialogHeader>
            <DialogTitle>Move to file</DialogTitle>
            <DialogDescription>
              Choose a TypeScript or JavaScript file in this workspace.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor={inputId}>Target file (workspace-relative)</Label>
            <Input
              id={inputId}
              name="target"
              placeholder="src/moved.ts"
              className="font-mono"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={error !== null}
              aria-describedby={error ? errorId : undefined}
              onChange={() => setError(null)}
            />
            {error && (
              <p id={errorId} role="alert" className="text-destructive text-sm">
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => close(null)}>
              Cancel
            </Button>
            <Button type="submit">Move</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
