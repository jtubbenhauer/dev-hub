import { LSP_DOCUMENT_EXTENSIONS } from "@/lib/lsp/types";

function encodePathSegments(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

function getLowercaseExtension(path: string): string {
  const basename = path.slice(path.lastIndexOf("/") + 1);
  const dotIndex = basename.lastIndexOf(".");
  return dotIndex === -1 ? "" : basename.slice(dotIndex).toLowerCase();
}

function getRemainderUnderRoot(
  absolutePath: string,
  workspaceRoot: string,
  isCaseInsensitive: boolean,
): string | null {
  const comparablePath = isCaseInsensitive
    ? absolutePath.toLowerCase()
    : absolutePath;
  const comparableRoot = isCaseInsensitive
    ? workspaceRoot.toLowerCase()
    : workspaceRoot;
  const rootPrefix = `${comparableRoot}/`;
  if (!comparablePath.startsWith(rootPrefix)) return null;
  const remainder = absolutePath.slice(rootPrefix.length);
  const hasInvalidSegment = remainder
    .split("/")
    .some((segment) => segment === ".." || segment === "");
  return hasInvalidSegment ? null : remainder;
}

export function workspaceRootToFileUri(workspaceRoot: string): string {
  return `file://${encodePathSegments(workspaceRoot)}`.replace(/\/+$/, "");
}

export function workspaceRelativePathToFileUri(
  workspaceRoot: string,
  relativePath: string,
): string {
  return `${workspaceRootToFileUri(workspaceRoot)}/${encodePathSegments(relativePath)}`;
}

export function fileUriToAbsolutePath(uri: string): string | null {
  try {
    const url = new URL(uri);
    if (url.protocol !== "file:") return null;
    return decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
}

export function fileUriToWorkspaceRelativePath(
  uri: string,
  workspaceRoot: string,
): string | null {
  const absolutePath = fileUriToAbsolutePath(uri);
  if (absolutePath === null) return null;
  return getRemainderUnderRoot(absolutePath, workspaceRoot, false);
}

export function isLspDocumentPath(path: string): boolean {
  const extension = getLowercaseExtension(path);
  return (LSP_DOCUMENT_EXTENSIONS as readonly string[]).includes(extension);
}

export function isLspDocumentUriInWorkspace(
  uri: string,
  workspaceRoot: string,
  options: { isCaseInsensitive: boolean },
): boolean {
  const absolutePath = fileUriToAbsolutePath(uri);
  if (absolutePath === null) return false;
  const relativePath = getRemainderUnderRoot(
    absolutePath,
    workspaceRoot,
    options.isCaseInsensitive,
  );
  return relativePath !== null && isLspDocumentPath(relativePath);
}

export function lspLanguageIdForPath(path: string): string | null {
  switch (getLowercaseExtension(path)) {
    case ".ts":
    case ".mts":
    case ".cts":
      return "typescript";
    case ".tsx":
      return "typescriptreact";
    case ".js":
    case ".mjs":
    case ".cjs":
      return "javascript";
    case ".jsx":
      return "javascriptreact";
    default:
      return null;
  }
}

export function monacoLanguageForPath(path: string): string | null {
  switch (getLowercaseExtension(path)) {
    case ".ts":
    case ".mts":
    case ".cts":
    case ".tsx":
      return "typescript";
    case ".js":
    case ".mjs":
    case ".cjs":
    case ".jsx":
      return "javascript";
    default:
      return null;
  }
}

export function toLowerCaseUriKey(uri: string): string {
  return uri.toLowerCase();
}
