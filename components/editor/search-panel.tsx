"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import {
  CaseSensitive,
  ChevronsDownUp,
  Ellipsis,
  Regex,
  RotateCw,
  WholeWord,
} from "lucide-react";
import type { ContentSearchFile, ContentSearchMatch } from "@devhub/shared";

import {
  PanelIconButton,
  SearchStatus,
} from "@/components/editor/search-panel-controls";
import {
  listVisibleMatches,
  SearchResults,
} from "@/components/editor/search-results";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useContentSearch } from "@/hooks/use-content-search";
import {
  buildContentSearchQuery,
  useContentSearchStore,
} from "@/stores/content-search-store";

const EMPTY_FILES: readonly ContentSearchFile[] = [];

export interface SearchPanelProps {
  workspaceId: string | null;
  onOpenMatch: (path: string, match: ContentSearchMatch) => void;
}

export function SearchPanel({ workspaceId, onOpenMatch }: SearchPanelProps) {
  const pattern = useContentSearchStore((s) => s.pattern);
  const isRegex = useContentSearchStore((s) => s.isRegex);
  const isCaseSensitive = useContentSearchStore((s) => s.isCaseSensitive);
  const isWholeWord = useContentSearchStore((s) => s.isWholeWord);
  const includeText = useContentSearchStore((s) => s.includeText);
  const excludeText = useContentSearchStore((s) => s.excludeText);
  const isDetailsOpen = useContentSearchStore((s) => s.isDetailsOpen);
  const pendingFocus = useContentSearchStore((s) => s.pendingFocus);

  const query = useMemo(
    () =>
      buildContentSearchQuery({
        pattern,
        isRegex,
        isCaseSensitive,
        isWholeWord,
        includeText,
        excludeText,
      }),
    [pattern, isRegex, isCaseSensitive, isWholeWord, includeText, excludeText],
  );
  const { outcome, isSearching, refresh } = useContentSearch({
    workspaceId,
    query,
  });

  const inputRef = useRef<HTMLInputElement>(null);
  const [collapsedPaths, setCollapsedPaths] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [selectedIndex, setSelectedIndex] = useState(-1);

  const files = outcome?.kind === "ok" ? outcome.files : EMPTY_FILES;

  // Reset selection when a new result set arrives (during-render pattern).
  const [prevFiles, setPrevFiles] = useState(files);
  if (files !== prevFiles) {
    setPrevFiles(files);
    setCollapsedPaths(new Set());
    setSelectedIndex(-1);
  }

  const visibleMatches = useMemo(
    () => listVisibleMatches(files, collapsedPaths),
    [files, collapsedPaths],
  );
  const selectedKey = visibleMatches[selectedIndex]?.key ?? null;

  useEffect(() => {
    if (!pendingFocus) return;
    inputRef.current?.focus();
    inputRef.current?.select();
    useContentSearchStore.getState().consumeFocus();
  }, [pendingFocus]);

  const moveSelection = (delta: 1 | -1) => {
    if (visibleMatches.length === 0) return;
    const nextIndex =
      delta === 1
        ? Math.min(selectedIndex + 1, visibleMatches.length - 1)
        : Math.max(selectedIndex - 1, 0);
    setSelectedIndex(nextIndex);
    const nextKey = visibleMatches[nextIndex]?.key;
    if (nextKey === undefined) return;
    document
      .querySelector(`[data-match-key="${CSS.escape(nextKey)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      moveSelection(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      moveSelection(-1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const target = visibleMatches[selectedIndex] ?? visibleMatches[0];
      if (target) onOpenMatch(target.path, target.match);
    } else if (e.key === "Escape") {
      e.currentTarget.blur();
    }
  };

  const handleSelectMatch = (
    path: string,
    match: ContentSearchMatch,
    key: string,
  ) => {
    setSelectedIndex(
      visibleMatches.findIndex((visible) => visible.key === key),
    );
    onOpenMatch(path, match);
  };

  const toggleFile = (path: string) => {
    setCollapsedPaths((previous) => {
      const next = new Set(previous);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const collapseAll = () => {
    setCollapsedPaths(new Set(files.map((file) => file.path)));
    setSelectedIndex(-1);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-col gap-1 border-b p-2">
        <div className="flex items-center gap-0.5">
          <Input
            ref={inputRef}
            aria-label="Search in files"
            placeholder="Search"
            value={pattern}
            onChange={(e) =>
              useContentSearchStore.getState().setPattern(e.target.value)
            }
            onKeyDown={handleSearchKeyDown}
            className="h-7 text-xs"
          />
          <PanelIconButton
            label="Match case"
            isPressed={isCaseSensitive}
            onClick={() =>
              useContentSearchStore
                .getState()
                .setIsCaseSensitive(!isCaseSensitive)
            }
          >
            <CaseSensitive />
          </PanelIconButton>
          <PanelIconButton
            label="Match whole word"
            isPressed={isWholeWord}
            onClick={() =>
              useContentSearchStore.getState().setIsWholeWord(!isWholeWord)
            }
          >
            <WholeWord />
          </PanelIconButton>
          <PanelIconButton
            label="Use regular expression"
            isPressed={isRegex}
            onClick={() =>
              useContentSearchStore.getState().setIsRegex(!isRegex)
            }
          >
            <Regex />
          </PanelIconButton>
        </div>
        <div className="flex items-center justify-end">
          <PanelIconButton
            label="Toggle search details"
            onClick={() =>
              useContentSearchStore.getState().setIsDetailsOpen(!isDetailsOpen)
            }
          >
            <Ellipsis />
          </PanelIconButton>
        </div>
        {isDetailsOpen && (
          <div className="flex flex-col gap-1">
            <Input
              aria-label="Files to include"
              placeholder="Files to include"
              value={includeText}
              onChange={(e) =>
                useContentSearchStore.getState().setIncludeText(e.target.value)
              }
              className="h-7 text-xs"
            />
            <Input
              aria-label="Files to exclude"
              placeholder="Files to exclude"
              value={excludeText}
              onChange={(e) =>
                useContentSearchStore.getState().setExcludeText(e.target.value)
              }
              className="h-7 text-xs"
            />
          </div>
        )}
        <div className="flex items-center justify-end gap-0.5">
          <PanelIconButton label="Refresh" onClick={refresh}>
            <RotateCw />
          </PanelIconButton>
          <PanelIconButton label="Collapse all" onClick={collapseAll}>
            <ChevronsDownUp />
          </PanelIconButton>
        </div>
      </div>
      <SearchStatus outcome={outcome} isSearching={isSearching} />
      <ScrollArea className="min-h-0 flex-1">
        <div className="p-1">
          <SearchResults
            files={files}
            selectedKey={selectedKey}
            onSelect={handleSelectMatch}
            collapsedPaths={collapsedPaths}
            onToggleFile={toggleFile}
          />
        </div>
      </ScrollArea>
    </div>
  );
}
