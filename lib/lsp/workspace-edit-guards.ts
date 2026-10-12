import type {
  LspCommand,
  LspPosition,
  LspRange,
  LspTextEdit,
  LspWorkspaceEdit,
} from "@/lib/lsp/types";

export function isLspRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPosition(value: unknown): value is LspPosition {
  return (
    isLspRecord(value) &&
    typeof value.line === "number" &&
    Number.isInteger(value.line) &&
    value.line >= 0 &&
    typeof value.character === "number" &&
    Number.isInteger(value.character) &&
    value.character >= 0
  );
}

export function isLspRange(value: unknown): value is LspRange {
  return (
    isLspRecord(value) &&
    isPosition(value.start) &&
    isPosition(value.end) &&
    (value.start.line < value.end.line ||
      (value.start.line === value.end.line &&
        value.start.character <= value.end.character))
  );
}

function isTextEdit(value: unknown): value is LspTextEdit {
  return (
    isLspRecord(value) &&
    isLspRange(value.range) &&
    typeof value.newText === "string" &&
    (value.annotationId === undefined || typeof value.annotationId === "string")
  );
}

export function isLspCommand(value: unknown): value is LspCommand {
  return (
    isLspRecord(value) &&
    typeof value.title === "string" &&
    typeof value.command === "string" &&
    (value.arguments === undefined || Array.isArray(value.arguments))
  );
}

function isDocumentChange(value: unknown): boolean {
  if (!isLspRecord(value)) return false;
  if (
    value.annotationId !== undefined &&
    typeof value.annotationId !== "string"
  )
    return false;
  if ("kind" in value) {
    if (
      value.options !== undefined &&
      (!isLspRecord(value.options) ||
        !Object.values(value.options).every(
          (option) => typeof option === "boolean",
        ))
    )
      return false;
    switch (value.kind) {
      case "create":
      case "delete":
        return typeof value.uri === "string";
      case "rename":
        return (
          typeof value.oldUri === "string" && typeof value.newUri === "string"
        );
      default:
        return false;
    }
  }
  return (
    isLspRecord(value.textDocument) &&
    typeof value.textDocument.uri === "string" &&
    (value.textDocument.version === null ||
      (typeof value.textDocument.version === "number" &&
        Number.isInteger(value.textDocument.version))) &&
    Array.isArray(value.edits) &&
    value.edits.every(isTextEdit)
  );
}

export function isLspWorkspaceEdit(value: unknown): value is LspWorkspaceEdit {
  if (!isLspRecord(value)) return false;
  if (
    value.changes !== undefined &&
    (!isLspRecord(value.changes) ||
      !Object.values(value.changes).every(
        (edits) => Array.isArray(edits) && edits.every(isTextEdit),
      ))
  )
    return false;
  if (
    value.documentChanges !== undefined &&
    (!Array.isArray(value.documentChanges) ||
      !value.documentChanges.every(isDocumentChange))
  )
    return false;
  if (
    value.changeAnnotations !== undefined &&
    (!isLspRecord(value.changeAnnotations) ||
      !Object.values(value.changeAnnotations).every(
        (annotation) =>
          isLspRecord(annotation) &&
          typeof annotation.label === "string" &&
          (annotation.needsConfirmation === undefined ||
            typeof annotation.needsConfirmation === "boolean") &&
          (annotation.description === undefined ||
            typeof annotation.description === "string"),
      ))
  )
    return false;
  return true;
}
