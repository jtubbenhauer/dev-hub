import { memo, useMemo } from "react";
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

interface SearchMatchRowProps {
  path: string;
  match: ContentSearchMatch;
  matchKey: string;
  isSelected: boolean;
  onSelect: (path: string, match: ContentSearchMatch, key: string) => void;
}

// Memoized so moving the selection re-renders only the two affected rows,
// not all (up to 2000) result rows.
const SearchMatchRow = memo(function SearchMatchRow({
  path,
  match,
  matchKey: rowKey,
  isSelected,
  onSelect,
}: SearchMatchRowProps) {
  const positions = useMemo(() => previewPositions(match), [match]);
  return (
    <button
      type="button"
      data-match-key={rowKey}
      className={cn(
        "flex w-full min-w-0 items-center rounded-sm py-0.5 pr-2 pl-8 text-xs",
        isSelected ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
      )}
      onClick={() => onSelect(path, match, rowKey)}
    >
      <span className="min-w-0 flex-1 overflow-hidden text-left font-mono text-ellipsis whitespace-pre">
        <HighlightedText text={match.preview} positions={positions} />
      </span>
    </button>
  );
});

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
        title={file.path}
        className="hover:bg-accent/50 flex w-full min-w-0 items-center gap-1.5 rounded-sm px-2 py-1 text-sm"
        onClick={() => onToggleFile(file.path)}
      >
        <ChevronRight
          className={cn(
            "text-muted-foreground size-3 shrink-0 transition-transform",
            !isCollapsed && "rotate-90",
          )}
        />
        <File className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
        <div className="flex min-w-0 flex-1 items-baseline gap-1.5 overflow-hidden text-left">
          <span className="max-w-full shrink-0 truncate font-mono text-xs">
            {basename}
          </span>
          {dirname && (
            <span className="text-muted-foreground min-w-0 flex-1 truncate text-[11px]">
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
          return (
            <SearchMatchRow
              key={key}
              path={file.path}
              match={match}
              matchKey={key}
              isSelected={key === selectedKey}
              onSelect={onSelect}
            />
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
