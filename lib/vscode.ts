import type { WorkspaceBackendType } from "@/types";

export type EditorFlavor =
  | "vscode"
  | "vscode-insiders"
  | "cursor"
  | "windsurf"
  | "vscodium";

export const EDITOR_FLAVOR_OPTIONS: EditorFlavor[] = [
  "vscode",
  "vscode-insiders",
  "cursor",
  "windsurf",
  "vscodium",
];

export const DEFAULT_EDITOR_FLAVOR: EditorFlavor = "vscode";

export const EDITOR_FLAVOR_LABELS: Record<EditorFlavor, string> = {
  vscode: "VS Code",
  "vscode-insiders": "VS Code Insiders",
  cursor: "Cursor",
  windsurf: "Windsurf",
  vscodium: "VSCodium",
};

// Only VS Code and Insiders schemes are documented by Microsoft. The others are
// confirmed by their own projects/communities but may lag on Remote-SSH URIs.
const FLAVOR_SCHEMES: Record<EditorFlavor, string> = {
  vscode: "vscode",
  "vscode-insiders": "vscode-insiders",
  cursor: "cursor",
  windsurf: "windsurf",
  vscodium: "vscodium",
};

export interface VscodeWorkspaceInput {
  path: string | null;
  backend: WorkspaceBackendType;
  sshTarget: string | null;
  sshPath: string | null;
}

export type VscodeTarget =
  | { kind: "local"; uri: string }
  | { kind: "remote"; uri: string; sshTarget: string; sshPath: string }
  | { kind: "unconfigured"; reason: string };

const MAX_SSH_TARGET_LENGTH = 255;

// Allows host, user@host, user@host:port, and bracketed IPv6. Anything outside
// this set (whitespace, control chars, shell metacharacters, slashes) is
// rejected rather than encoded, so a malformed target can never alter the
// structure of the generated URI.
const SSH_TARGET_ALLOWED = /^[A-Za-z0-9._@:[\]-]+$/;

export function isValidSshTarget(target: string): boolean {
  if (target.length === 0 || target.length > MAX_SSH_TARGET_LENGTH) {
    return false;
  }
  // A leading dash would be parsed as an option by ssh and by VS Code's
  // authority parser.
  if (target.startsWith("-")) return false;
  return SSH_TARGET_ALLOWED.test(target);
}

// Encodes each path segment individually so that spaces, "#", "?" and "%" are
// escaped while the structural slashes and a Windows drive letter survive.
export function encodeUriPath(rawPath: string): string {
  const normalized = rawPath.replaceAll("\\", "/");
  return normalized
    .split("/")
    .map((segment, index) =>
      index === 0 && /^[A-Za-z]:$/.test(segment)
        ? segment.toLowerCase()
        : encodeURIComponent(segment),
    )
    .join("/");
}

// Becomes forceNewWindow in VS Code's URL handler, overriding the user's
// openFoldersInNewWindow setting. Must follow the trailing slash.
const NEW_WINDOW_QUERY = "?windowId=_blank";

function withLeadingSlash(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

function withTrailingSlash(path: string): string {
  return path.endsWith("/") ? path : `${path}/`;
}

export function buildLocalFolderUri(
  absolutePath: string,
  flavor: EditorFlavor = DEFAULT_EDITOR_FLAVOR,
): string {
  const scheme = FLAVOR_SCHEMES[flavor];
  const encoded = encodeUriPath(withLeadingSlash(absolutePath));
  return `${scheme}://file${withTrailingSlash(encoded)}${NEW_WINDOW_QUERY}`;
}

export function buildRemoteFolderUri(
  sshTarget: string,
  absolutePath: string,
  flavor: EditorFlavor = DEFAULT_EDITOR_FLAVOR,
): string {
  const scheme = FLAVOR_SCHEMES[flavor];
  const encoded = encodeUriPath(withLeadingSlash(absolutePath));
  return `${scheme}://vscode-remote/ssh-remote+${sshTarget}${withTrailingSlash(encoded)}${NEW_WINDOW_QUERY}`;
}

export function resolveVscodeTarget(
  workspace: VscodeWorkspaceInput,
  flavor: EditorFlavor = DEFAULT_EDITOR_FLAVOR,
): VscodeTarget {
  const workspacePath = workspace.path?.trim();

  if (workspace.backend === "local") {
    if (!workspacePath) {
      return { kind: "unconfigured", reason: "Workspace has no path" };
    }
    return { kind: "local", uri: buildLocalFolderUri(workspacePath, flavor) };
  }

  const sshTarget = workspace.sshTarget?.trim();
  if (!sshTarget) {
    return {
      kind: "unconfigured",
      reason: "No SSH target configured for this remote workspace",
    };
  }

  if (!isValidSshTarget(sshTarget)) {
    return { kind: "unconfigured", reason: "SSH target is not a valid host" };
  }

  // When the agent declares an SSH target but no host path, the agent is
  // running directly on the SSH host, so its WORKSPACE_PATH is already correct.
  const sshPath = workspace.sshPath?.trim() || workspacePath;
  if (!sshPath) {
    return { kind: "unconfigured", reason: "Workspace has no path" };
  }

  return {
    kind: "remote",
    uri: buildRemoteFolderUri(sshTarget, sshPath, flavor),
    sshTarget,
    sshPath,
  };
}
