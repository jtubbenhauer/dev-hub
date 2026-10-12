import type { MonacoLanguageClient } from "monaco-languageclient";
import * as vscode from "vscode";
import { getRegisteredLspMonaco } from "@/lib/lsp/client/lsp-session";
import { handleWorkspaceEditResult } from "@/lib/lsp/client/workspace-edit-sync";
import {
  isLspRecord,
  LSP_APPLY_EDIT_COMMAND,
  type LspWorkspaceEditResult,
} from "@/lib/lsp/types";
import { useLspDialogStore } from "@/stores/lsp-dialog-store";

function renameAt(uri: unknown, position: unknown): void {
  if (
    typeof uri !== "string" ||
    !isLspRecord(position) ||
    typeof position.line !== "number" ||
    !Number.isInteger(position.line) ||
    position.line < 0 ||
    typeof position.character !== "number" ||
    !Number.isInteger(position.character) ||
    position.character < 0
  )
    return;
  const editor = getRegisteredLspMonaco()
    ?.editor.getEditors()
    .find(
      (candidate) =>
        candidate.getModel()?.uri.toString().toLowerCase() ===
        uri.toLowerCase(),
    );
  if (!editor) return;
  editor.setPosition({
    lineNumber: position.line + 1,
    column: position.character + 1,
  });
  editor.focus();
  editor.trigger("lsp", "editor.action.rename", null);
}

function isWorkspaceEditResult(
  value: unknown,
): value is LspWorkspaceEditResult {
  return (
    isLspRecord(value) &&
    typeof value.applied === "boolean" &&
    (value.reason === null || typeof value.reason === "string") &&
    Array.isArray(value.changedUris) &&
    value.changedUris.every((uri) => typeof uri === "string") &&
    Array.isArray(value.createdUris) &&
    value.createdUris.every((uri) => typeof uri === "string")
  );
}

export function registerLspClientCommands(
  client: MonacoLanguageClient,
  context: { readonly workspaceId: string; readonly workspaceRoot: string },
): { dispose(): void } {
  const registrations: vscode.Disposable[] = [];
  let isDisposed = false;
  let pendingMoveCount = 0;
  function dispose() {
    if (isDisposed) return;
    isDisposed = true;
    if (pendingMoveCount > 0) useLspDialogStore.getState().close(null);
    for (const registration of registrations) registration.dispose();
  }
  try {
    registrations.push(
      vscode.commands.registerCommand("devhub.lsp.renameAt", renameAt),
    );
    registrations.push(
      vscode.commands.registerCommand(
        "devhub.lsp.applyEdit",
        async (editId: string, followUp: unknown) => {
          const response: unknown = await client.sendRequest(
            "workspace/executeCommand",
            {
              command: LSP_APPLY_EDIT_COMMAND,
              arguments: [editId],
            },
          );
          const result: LspWorkspaceEditResult = isWorkspaceEditResult(response)
            ? response
            : {
                applied: false,
                reason: "unexpected response",
                changedUris: [],
                createdUris: [],
              };
          const monaco = getRegisteredLspMonaco();
          if (!monaco) return;
          await handleWorkspaceEditResult(result, { monaco, ...context });
          if (
            !result.applied ||
            isDisposed ||
            !isLspRecord(followUp) ||
            typeof followUp.command !== "string"
          )
            return;
          const args: unknown[] = Array.isArray(followUp.arguments)
            ? followUp.arguments
            : [];
          if (followUp.command === "editor.action.rename") {
            const target: unknown = args[0];
            if (Array.isArray(target)) renameAt(target[0], target[1]);
          } else {
            await vscode.commands.executeCommand(followUp.command, ...args);
          }
        },
      ),
    );
    registrations.push(
      vscode.commands.registerCommand(
        "_typescript.moveToFileRefactoring",
        async (action: unknown, uri: string, range: unknown) => {
          pendingMoveCount++;
          const path = await useLspDialogStore.getState().open();
          pendingMoveCount--;
          if (path === null || isDisposed) return;
          await client.sendRequest("workspace/executeCommand", {
            command: "_typescript.moveToFileRefactoring",
            arguments: [action, uri, range, path],
          });
        },
      ),
    );
    // VS Code's TypeScript extension uses this follow-up only to log telemetry.
    registrations.push(
      vscode.commands.registerCommand(
        "_typescript.didOrganizeImports",
        () => undefined,
      ),
    );
    return { dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}
