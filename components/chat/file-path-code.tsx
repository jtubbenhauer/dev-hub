"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { FileCode2, FolderOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { openFileInSplitPanel } from "@/lib/split-panel-open-file";

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

interface FilePathCodeProps {
  children: React.ReactNode;
  text: string;
}

export function FilePathCode({ children, text }: FilePathCodeProps) {
  const router = useRouter();
  const isMobile = useIsMobile();
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);

  const cleanPath = stripPath(text);
  const isFolder = !isFilePath(text) && isFolderPath(text);
  const href = isFolder
    ? `/files?expand=${encodeURIComponent(cleanPath)}`
    : `/files?open=${encodeURIComponent(cleanPath)}`;

  const handleClick = useCallback(
    async (e: React.MouseEvent) => {
      e.preventDefault();
      if (isMobile || isFolder) {
        router.push(href);
        return;
      }
      await openFileInSplitPanel(activeWorkspaceId ?? "", cleanPath, () =>
        router.push(href),
      );
    },
    [router, href, isMobile, isFolder, cleanPath, activeWorkspaceId],
  );

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
