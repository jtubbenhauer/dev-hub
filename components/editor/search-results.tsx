import { ChevronRight, File } from "lucide-react";
import type { ContentSearchFile, ContentSearchMatch } from "@devhub/shared";

import { HighlightedText } from "@/components/ui/highlighted-text";
import { cn } from "@/lib/utils";

export interface VisibleMatch {
  readonly path: string;
  readonly match: ContentSearchMatch;
  readonly key: string;
}

export function matchKey(path: string, matchIndex: number): string {
  return `${path}:${matchIndex}`;
}

export function listVisibleMatches(
  files: readonly ContentSearchFile[],
  collapsedPaths: ReadonlySet<string>,
): VisibleMatch[] {
  const visibleMatches: VisibleMatch[] = [];
  for (const file of files) {
    if (collapsedPaths.has(file.path)) continue;
    file.matches.forEach((match, index) => {
      visibleMatches.push({
        path: file.path,
        match,
        key: matchKey(file.path, index),
      });
    });
  }
  return visibleMatches;
}

function previewPositions(match: ContentSearchMatch): Set<number> {
  const positions = new Set<number>();
  for (let i = match.previewMatchStart; i < match.previewMatchEnd; i++) {
    positions.add(i);
  }
  return positions;
}

interface SearchResultFileProps {
  file: ContentSearchFile;
  isCollapsed: boolean;
  selectedKey: string | null;
  onSelect: (path: string, match: ContentSearchMatch, key: string) => void;
  onToggleFile: (path: string) => void;
}

function SearchResultFile({
  file,
  isCollapsed,
  selectedKey,
  onSelect,
  onToggleFile,
}: SearchResultFileProps) {
  const basename = file.path.split("/").pop() ?? file.path;
  const dirname = file.path.includes("/")
    ? file.path.slice(0, file.path.lastIndexOf("/"))
    : "";

  return (
    <div>
      <button
        type="button"
        className="hover:bg-accent/50 flex w-full items-center gap-1.5 rounded-sm px-2 py-1 text-sm"
        onClick={() => onToggleFile(file.path)}
      >
        <ChevronRight
          className={cn(
            "text-muted-foreground size-3 shrink-0 transition-transform",
            !isCollapsed && "rotate-90",
          )}
        />
        <File className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
        <div className="flex min-w-0 flex-1 items-baseline gap-1.5 text-left">
          <span className="shrink-0 font-mono text-xs">{basename}</span>
          {dirname && (
            <span className="text-muted-foreground truncate text-[11px]">
              {dirname}
            </span>
          )}
        </div>
        <span className="text-muted-foreground bg-accent shrink-0 rounded-full px-1.5 text-[10px]">
          {file.matches.length}
        </span>
      </button>
      {!isCollapsed &&
        file.matches.map((match, index) => {
          const key = matchKey(file.path, index);
          const isSelected = key === selectedKey;
          return (
            <button
              key={key}
              type="button"
              data-match-key={key}
              className={cn(
                "flex w-full items-center rounded-sm py-0.5 pr-2 pl-8 text-xs",
                isSelected
                  ? "bg-accent text-accent-foreground"
                  : "hover:bg-accent/50",
              )}
              onClick={() => onSelect(file.path, match, key)}
            >
              <span className="truncate font-mono whitespace-pre">
                <HighlightedText
                  text={match.preview}
                  positions={previewPositions(match)}
                />
              </span>
            </button>
          );
        })}
    </div>
  );
}

export interface SearchResultsProps {
  files: readonly ContentSearchFile[];
  selectedKey: string | null;
  onSelect: (path: string, match: ContentSearchMatch, key: string) => void;
  collapsedPaths: ReadonlySet<string>;
  onToggleFile: (path: string) => void;
}

export function SearchResults({
  files,
  selectedKey,
  onSelect,
  collapsedPaths,
  onToggleFile,
}: SearchResultsProps) {
  return (
    <>
      {files.map((file) => (
        <SearchResultFile
          key={file.path}
          file={file}
          isCollapsed={collapsedPaths.has(file.path)}
          selectedKey={selectedKey}
          onSelect={onSelect}
          onToggleFile={onToggleFile}
        />
      ))}
    </>
  );
}
