import * as nodeFs from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import {
  fileUriToAbsolutePath,
  fileUriToWorkspaceRelativePath,
  workspaceRelativePathToFileUri,
} from "@/lib/lsp/document-scope";
import { applyLspTextEdits } from "@/lib/lsp/text-edits";
import {
  isLspWorkspaceEdit,
  type LspCreateFile,
  type LspDeleteFile,
  type LspRenameFile,
  type LspSyncedDocument,
  type LspTextEdit,
  type LspWorkspaceEdit,
  type LspWorkspaceEditResult,
} from "@/lib/lsp/types";
import {
  commitWorkspaceEdit,
  type PreparedFile,
  type WriterFs,
} from "@/lib/lsp/workspace-edit-commit";

export type { WriterFs } from "@/lib/lsp/workspace-edit-commit";
type EditOperation =
  | {
      readonly kind: "text";
      readonly uri: string;
      readonly version: number | null;
      readonly edits: readonly LspTextEdit[];
    }
  | LspCreateFile
  | LspRenameFile
  | LspDeleteFile;
type WriterOptions = {
  readonly workspaceRoot: string;
  readonly edit: LspWorkspaceEdit;
  readonly syncedDocuments: ReadonlyMap<string, LspSyncedDocument>;
  readonly dirtyUris: ReadonlySet<string>;
  readonly fsImpl?: WriterFs;
};

function normalize(edit: LspWorkspaceEdit): EditOperation[] {
  const operations: EditOperation[] = [];
  if (edit.documentChanges !== undefined) {
    for (const operation of edit.documentChanges)
      operations.push(
        "kind" in operation
          ? operation
          : {
              kind: "text",
              uri: operation.textDocument.uri,
              version: operation.textDocument.version,
              edits: operation.edits,
            },
      );
  } else {
    for (const [uri, edits] of Object.entries(edit.changes ?? {}))
      operations.push({ kind: "text", uri, version: null, edits });
  }
  return operations;
}

export function applyWorkspaceEditToDisk(
  options: WriterOptions,
): LspWorkspaceEditResult {
  const { workspaceRoot, edit, syncedDocuments, dirtyUris } = options;
  const fs = options.fsImpl ?? {
    ...nodeFs,
    realpathSync: nodeFs.realpathSync.native,
  };
  const refused = (reason: string): LspWorkspaceEditResult => ({
    applied: false,
    reason,
    changedUris: [],
    createdUris: [],
  });
  if (!isLspWorkspaceEdit(edit)) return refused("malformed edit");
  const prepared = new Map<string, PreparedFile>();
  let offendingPath = workspaceRoot;
  try {
    const rootReal = fs.realpathSync(workspaceRoot);
    for (const operation of normalize(edit)) {
      const uri = "uri" in operation ? operation.uri : operation.oldUri;
      const relativePath = fileUriToWorkspaceRelativePath(uri, workspaceRoot);
      offendingPath =
        relativePath ??
        relative(workspaceRoot, fileUriToAbsolutePath(uri) ?? uri);
      switch (operation.kind) {
        case "rename":
          return refused(`${offendingPath}: file rename is not supported`);
        case "delete":
          return refused(`${offendingPath}: file deletion is not supported`);
        case "create":
        case "text":
          break;
        default:
          return operation satisfies never;
      }
      if (relativePath === null)
        return refused(`${offendingPath}: outside workspace or not a file URI`);
      const target = join(workspaceRoot, relativePath);
      const exists = fs.existsSync(target);
      const resolved = fs.realpathSync(exists ? target : dirname(target));
      if (
        !(
          resolved.startsWith(`${rootReal}/`) ||
          (!exists && resolved === rootReal)
        )
      )
        return refused(`${relativePath}: outside workspace (realpath)`);
      const path = exists ? resolved : join(resolved, basename(target));
      const realRelativePath = relative(rootReal, path);
      const realUri = workspaceRelativePathToFileUri(
        workspaceRoot,
        realRelativePath,
      );
      let file = prepared.get(path);
      const original =
        file === undefined
          ? exists
            ? fs.readFileSync(path, "utf8")
            : null
          : file.original;
      const synced = syncedDocuments.get(uri) ?? syncedDocuments.get(realUri);
      if (
        dirtyUris.has(uri) ||
        dirtyUris.has(realUri) ||
        (synced !== undefined && synced.text !== original)
      )
        return refused(`${relativePath} has unsaved changes — save it first`);
      switch (operation.kind) {
        case "text":
          if (
            operation.version !== null &&
            operation.version !== synced?.version
          )
            return refused(`${relativePath}: stale edit`);
          if (file === undefined && original === null)
            return refused(`${relativePath}: file does not exist`);
          file ??= {
            path,
            relativePath: realRelativePath,
            uri: realUri,
            original,
            next: original ?? "",
          };
          file.next = applyLspTextEdits(file.next, operation.edits);
          break;
        case "create": {
          const isPresent = file !== undefined || exists;
          if (
            isPresent &&
            !operation.options?.overwrite &&
            !operation.options?.ignoreIfExists
          )
            return refused(`${relativePath}: file already exists`);
          file ??= {
            path,
            relativePath: realRelativePath,
            uri: realUri,
            original,
            next: original ?? "",
          };
          if (!isPresent || operation.options?.overwrite) file.next = "";
          break;
        }
        default:
          return operation satisfies never;
      }
      prepared.set(path, file);
    }
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return refused(`${offendingPath}: ${error.message}`);
  }
  const files: PreparedFile[] = [];
  for (const file of prepared.values())
    if (file.next !== file.original) files.push(file);
  return commitWorkspaceEdit(files, fs);
}
