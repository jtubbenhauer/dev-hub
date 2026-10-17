"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { defaultUrlTransform } from "react-markdown";
import { FileCode2, FolderOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { openFileInSidePanel } from "@/lib/side-panel-open-file";
import { useChatFileOpenSetting } from "@/hooks/use-settings";
import { useChatFileDialogStore } from "@/stores/chat-file-dialog-store";

const FILE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
  ".json",
  ".html",
  ".htm",
  ".css",
  ".scss",
  ".less",
  ".md",
  ".mdx",
  ".py",
  ".rs",
  ".go",
  ".rb",
  ".java",
  ".kt",
  ".yaml",
  ".yml",
  ".toml",
  ".xml",
  ".svg",
  ".sh",
  ".bash",
  ".zsh",
  ".fish",
  ".sql",
  ".graphql",
  ".gql",
  ".dockerfile",
  ".env",
  ".gitignore",
  ".c",
  ".cpp",
  ".h",
  ".hpp",
  ".swift",
  ".lua",
  ".php",
  ".r",
  ".vue",
  ".svelte",
  ".lock",
  ".config",
  ".txt",
  ".log",
  ".csv",
]);

const KNOWN_DOTFILES = new Set([
  ".env",
  ".env.local",
  ".env.development",
  ".env.production",
  ".gitignore",
  ".gitattributes",
  ".gitmodules",
  ".eslintrc",
  ".prettierrc",
  ".editorconfig",
  ".npmrc",
  ".nvmrc",
  ".dockerignore",
]);

const KNOWN_FILENAMES = new Set([
  "dockerfile",
  "makefile",
  "procfile",
  "gemfile",
  "rakefile",
  "cmakelists.txt",
  "cargo.toml",
  "package.json",
  "tsconfig.json",
  "vite.config.ts",
]);

const REJECT_PATTERN = /[=;{}()[\]<>|&!@#$%^*+?'"`,]/;

function passesBasicChecks(text: string): boolean {
  if (text.length < 2 || text.length > 200) return false;
  if (text.includes("\n") || text.includes("  ")) return false;
  if (text.startsWith("http://") || text.startsWith("https://")) return false;
  if (REJECT_PATTERN.test(text)) return false;
  return true;
}

export function isFilePath(text: string): boolean {
  const trimmed = text.trim();
  if (!passesBasicChecks(trimmed)) return false;

  const baseName = trimmed.split("/").pop() ?? trimmed;
  if (KNOWN_FILENAMES.has(baseName.toLowerCase())) return true;
  if (KNOWN_DOTFILES.has(baseName.toLowerCase())) return true;

  const lastDot = baseName.lastIndexOf(".");
  if (lastDot > 0) {
    const ext = baseName.slice(lastDot).toLowerCase();
    if (FILE_EXTENSIONS.has(ext)) return true;
  }

  return false;
}

export function isFolderPath(text: string): boolean {
  const trimmed = text.trim();
  if (!passesBasicChecks(trimmed)) return false;
  if (!trimmed.includes("/")) return false;

  const cleaned = trimmed.replace(/^\.\//, "").replace(/\/$/, "");
  if (!cleaned.includes("/")) return false;

  const segments = cleaned.split("/");
  if (segments.some((s) => s === "" || s === "..")) return false;

  const lastSegment = segments[segments.length - 1];
  if (lastSegment.includes(".")) return false;

  return true;
}

export function isCodePath(text: string): boolean {
  return isFilePath(text) || isFolderPath(text);
}

function stripPath(text: string): string {
  let p = text.trim();
  if (p.startsWith("./")) p = p.slice(2);
  if (p.startsWith("/")) p = p.slice(1);
  if (p.endsWith("/")) p = p.slice(0, -1);
  return p;
}

// Normalises a markdown link href (relative path, absolute path, file:// URL,
// optional :line[:col] or #L12 suffix) into a path, or null if it is not a
// local file/folder link.
export function parseFileLinkHref(href: string): string | null {
  let path = href.trim();
  if (path.startsWith("file://")) path = path.slice("file://".length);
  path = path.replace(/[?#].*$/, "").replace(/:\d+(?::\d+)?$/, "");
  try {
    path = decodeURIComponent(path);
  } catch {
    return null;
  }
  if (path.includes(":")) return null;
  return isCodePath(path) ? path : null;
}

export function resolveWorkspaceFilePath(
  path: string,
  workspaceRoots: string[],
): string | null {
  if (!path.startsWith("/")) return path.replace(/^\.\//, "");
  for (const root of workspaceRoots) {
    const normalizedRoot = root.replace(/\/+$/, "");
    if (normalizedRoot && path.startsWith(`${normalizedRoot}/`)) {
      return path.slice(normalizedRoot.length + 1);
    }
  }
  return null;
}

function useOpenCodePath(path: string) {
  const router = useRouter();
  const isMobile = useIsMobile();
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const { fileOpenMode } = useChatFileOpenSetting();

  const cleanPath = stripPath(path);
  const isFolder = !isFilePath(path) && isFolderPath(path);
  const href = isFolder
    ? `/files?expand=${encodeURIComponent(cleanPath)}`
    : `/files?open=${encodeURIComponent(cleanPath)}`;

  const handleClick = useCallback(
    async (e: React.MouseEvent) => {
      e.preventDefault();
      if (isFolder || (isMobile && fileOpenMode === "sidebar")) {
        router.push(href);
        return;
      }
      if (fileOpenMode === "dialog") {
        await useChatFileDialogStore
          .getState()
          .openFile(activeWorkspaceId ?? "", cleanPath, () =>
            router.push(href),
          );
        return;
      }
      await openFileInSidePanel(activeWorkspaceId ?? "", cleanPath, () =>
        router.push(href),
      );
    },
    [
      router,
      href,
      isMobile,
      isFolder,
      fileOpenMode,
      cleanPath,
      activeWorkspaceId,
    ],
  );

  return { href, isFolder, handleClick };
}

interface FilePathCodeProps {
  children: React.ReactNode;
  text: string;
}

export function FilePathCode({ children, text }: FilePathCodeProps) {
  const { href, isFolder, handleClick } = useOpenCodePath(text);
  const Icon = isFolder ? FolderOpen : FileCode2;

  return (
    <a
      href={href}
      className={cn(
        "bg-muted rounded px-1.5 py-0.5 font-mono text-sm no-underline",
        "hover:bg-primary/20 hover:text-primary cursor-pointer transition-colors",
        "inline-flex items-center gap-1",
      )}
      onClick={handleClick}
    >
      <Icon className="inline size-3 shrink-0" />
      {children}
    </a>
  );
}

function WorkspacePathLink({
  children,
  path,
}: {
  children: React.ReactNode;
  path: string;
}) {
  const { href, isFolder, handleClick } = useOpenCodePath(path);
  const Icon = isFolder ? FolderOpen : FileCode2;

  return (
    <a
      href={href}
      className="inline-flex cursor-pointer items-center gap-1"
      onClick={handleClick}
    >
      <Icon className="inline size-3 shrink-0" />
      {children}
    </a>
  );
}

// Markdown link renderer: local file links open in the editor, everything else
// stays a normal (sanitised) link.
export function FilePathLink({
  href = "",
  children,
  ...anchorProps
}: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  const workspacePath = useWorkspaceStore(
    (s) => s.workspaces.find((w) => w.id === s.activeWorkspaceId)?.path,
  );
  const workspaceSshPath = useWorkspaceStore(
    (s) => s.workspaces.find((w) => w.id === s.activeWorkspaceId)?.sshPath,
  );

  const parsedPath = parseFileLinkHref(href);
  const workspaceRoots = [workspacePath, workspaceSshPath].filter(
    (root): root is string => typeof root === "string" && root.length > 0,
  );
  const workspaceFilePath =
    parsedPath === null
      ? null
      : resolveWorkspaceFilePath(parsedPath, workspaceRoots);

  if (workspaceFilePath === null) {
    return (
      <a {...anchorProps} href={defaultUrlTransform(href)}>
        {children}
      </a>
    );
  }
  return (
    <WorkspacePathLink path={workspaceFilePath}>{children}</WorkspacePathLink>
  );
}
