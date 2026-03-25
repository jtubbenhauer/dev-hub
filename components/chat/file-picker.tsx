"use client";

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  useDeferredValue,
} from "react";
import { FileIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { fuzzySearch, basenamePositions } from "@/lib/fuzzy-match";
import { useWorkspaceFiles } from "@/components/file-picker/file-picker";
import { HighlightedText } from "@/components/ui/highlighted-text";

interface FilePickerProps {
  workspaceId: string;
  query: string;
  onSelect: (path: string) => void;
  onClose: () => void;
}

export function FilePicker({
  workspaceId,
  query,
  onSelect,
  onClose,
}: FilePickerProps) {
  const { data: allFiles } = useWorkspaceFiles(workspaceId);
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const deferredQuery = useDeferredValue(query);
  const results = useMemo(
    () => fuzzySearch(deferredQuery, allFiles ?? [], 50),
    [deferredQuery, allFiles],
  );

  // Reset active index when query changes
  const [prevQuery, setPrevQuery] = useState(query);
  if (prevQuery !== query) {
    setPrevQuery(query);
    setActiveIndex(0);
  }

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setActiveIndex((prev) => Math.min(prev + 1, results.length - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setActiveIndex((prev) => Math.max(prev - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          if (results[activeIndex]) onSelect(results[activeIndex].path);
          break;
        case "Escape":
          e.preventDefault();
          onClose();
          break;
      }
    },
    [results, activeIndex, onSelect, onClose],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // Scroll active item into view
  useEffect(() => {
    const item = listRef.current?.children[activeIndex] as
      | HTMLElement
      | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  if (results.length === 0) {
    return (
      <div className="bg-popover absolute bottom-full mb-1 max-h-56 w-full overflow-hidden rounded-lg border shadow-md">
        <p className="text-muted-foreground px-3 py-2 text-xs">
          No files found
        </p>
      </div>
    );
  }

  return (
    <div className="bg-popover absolute bottom-full mb-1 max-h-56 w-full overflow-y-auto rounded-lg border shadow-md">
      <div ref={listRef}>
        {results.map((match, index) => {
          const fileName = match.path.split("/").pop() ?? match.path;
          const dirPath = match.path.includes("/")
            ? match.path.slice(0, match.path.lastIndexOf("/"))
            : "";
          return (
            <button
              key={match.path}
              className={cn(
                "hover:bg-accent flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs",
                index === activeIndex && "bg-accent",
              )}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => onSelect(match.path)}
            >
              <FileIcon className="text-muted-foreground size-3 shrink-0" />
              <span className="truncate">
                <HighlightedText
                  text={fileName}
                  positions={basenamePositions(match.path, match.positions)}
                />
                {dirPath && (
                  <span className="text-muted-foreground/60 ml-1">
                    {dirPath}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
