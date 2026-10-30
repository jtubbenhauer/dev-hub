"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { SearchAddon } from "@xterm/addon-search";
import { ChevronDown, ChevronUp, X } from "lucide-react";

interface TerminalSearchBarProps {
  searchAddon: SearchAddon;
  onClose: () => void;
}

export function TerminalSearchBar({
  searchAddon,
  onClose,
}: TerminalSearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [hasNoMatch, setHasNoMatch] = useState(false);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const findNext = (incremental = false) => {
    if (!query) return;
    setHasNoMatch(!searchAddon.findNext(query, { incremental }));
  };

  const findPrevious = () => {
    if (!query) return;
    setHasNoMatch(!searchAddon.findPrevious(query));
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (event.shiftKey) findPrevious();
      else findNext();
    }
  };

  return (
    <div className="bg-popover absolute top-2 right-3 z-10 flex items-center gap-1 rounded-md border p-1 shadow-md">
      <input
        ref={inputRef}
        value={query}
        onChange={(event) => {
          const nextQuery = event.target.value;
          setQuery(nextQuery);
          if (!nextQuery) {
            searchAddon.clearDecorations();
            setHasNoMatch(false);
            return;
          }
          setHasNoMatch(
            !searchAddon.findNext(nextQuery, { incremental: true }),
          );
        }}
        onKeyDown={handleKeyDown}
        placeholder="Find"
        aria-label="Find in terminal"
        className={`bg-background h-6 w-44 rounded-sm border px-2 text-xs outline-none ${
          hasNoMatch ? "border-destructive" : ""
        }`}
      />
      <button
        type="button"
        onClick={findPrevious}
        title="Previous match (Shift+Enter)"
        className="hover:bg-accent rounded-sm p-1"
      >
        <ChevronUp className="size-3.5" />
      </button>
      <button
        type="button"
        onClick={() => findNext()}
        title="Next match (Enter)"
        className="hover:bg-accent rounded-sm p-1"
      >
        <ChevronDown className="size-3.5" />
      </button>
      <button
        type="button"
        onClick={onClose}
        title="Close (Esc)"
        className="hover:bg-accent rounded-sm p-1"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
