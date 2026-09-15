"use client";

import type React from "react";

import { ChevronRight, FolderOpen } from "lucide-react";

import { countTreeFiles, type FileTreeFolder } from "@/lib/git-file-tree";
import { cn } from "@/lib/utils";

interface FolderTreeProps<T extends { path: string }> {
  root: FileTreeFolder<T>;
  collapsedFolders: Set<string>;
  onToggleFolder: (path: string) => void;
  renderFile: (item: T) => React.ReactNode;
}

interface FolderTreeNodeProps<T extends { path: string }> {
  folder: FileTreeFolder<T>;
  collapsedFolders: Set<string>;
  onToggleFolder: (path: string) => void;
  renderFile: (item: T) => React.ReactNode;
}

function FolderTreeChildren<T extends { path: string }>({
  folder,
  collapsedFolders,
  onToggleFolder,
  renderFile,
}: FolderTreeNodeProps<T>) {
  return (
    <>
      {folder.folders.map((child) => (
        <FolderTreeNode
          key={child.path}
          folder={child}
          collapsedFolders={collapsedFolders}
          onToggleFolder={onToggleFolder}
          renderFile={renderFile}
        />
      ))}
      {folder.files.map((file) => (
        <div key={file.path}>{renderFile(file)}</div>
      ))}
    </>
  );
}

function FolderTreeNode<T extends { path: string }>({
  folder,
  collapsedFolders,
  onToggleFolder,
  renderFile,
}: FolderTreeNodeProps<T>) {
  const isCollapsed = collapsedFolders.has(folder.path);

  return (
    <div>
      <button
        type="button"
        className="text-muted-foreground hover:bg-accent/50 flex w-full items-center gap-1 rounded-sm px-2 py-1 text-[11px]"
        onClick={() => onToggleFolder(folder.path)}
      >
        <ChevronRight
          className={cn(
            "size-3 shrink-0 transition-transform",
            !isCollapsed && "rotate-90",
          )}
        />
        <FolderOpen className="size-3 shrink-0" />
        <span className="truncate">{folder.name}</span>
        <span className="ml-auto shrink-0 text-[10px]">
          {countTreeFiles(folder)}
        </span>
      </button>
      {!isCollapsed && (
        <div className="ml-2">
          <FolderTreeChildren
            folder={folder}
            collapsedFolders={collapsedFolders}
            onToggleFolder={onToggleFolder}
            renderFile={renderFile}
          />
        </div>
      )}
    </div>
  );
}

export function FolderTree<T extends { path: string }>({
  root,
  collapsedFolders,
  onToggleFolder,
  renderFile,
}: FolderTreeProps<T>) {
  return (
    <FolderTreeChildren
      folder={root}
      collapsedFolders={collapsedFolders}
      onToggleFolder={onToggleFolder}
      renderFile={renderFile}
    />
  );
}
