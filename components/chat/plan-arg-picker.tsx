"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { FileText } from "lucide-react";
import { cn } from "@/lib/utils";

interface PlanFile {
  name: string;
  path: string;
  lastModified: string;
}

interface PlanArgPickerProps {
  workspaceId: string;
  query: string;
  onSelect: (fileName: string) => void;
  onClose: () => void;
}

function fuzzyMatch(value: string, query: string): boolean {
  if (!query) return true;
  const lower = value.toLowerCase();
  const q = query.toLowerCase();
  let qi = 0;
  for (let i = 0; i < lower.length && qi < q.length; i++) {
    if (lower[i] === q[qi]) qi++;
  }
  return qi === q.length;
}

function timeAgo(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;
  const years = Math.floor(days / 365);
  return `${years} year${years === 1 ? "" : "s"} ago`;
}

export function PlanArgPicker({
  workspaceId,
  query,
  onSelect,
  onClose,
}: PlanArgPickerProps) {
  const [files, setFiles] = useState<PlanFile[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let mounted = true;
    async function fetchPlans() {
      try {
        const res = await fetch(`/api/files/plans?workspaceId=${workspaceId}`);
        if (!res.ok) return;
        const data = await res.json();
        if (mounted && data.files) {
          setFiles(data.files);
        }
      } catch {
        // Ignore errors
      }
    }
    fetchPlans();
    return () => {
      mounted = false;
    };
  }, [workspaceId]);

  const filtered = useMemo(
    () => files.filter((f) => fuzzyMatch(f.name, query)).slice(0, 50),
    [files, query],
  );

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
          setActiveIndex((prev) => Math.min(prev + 1, filtered.length - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setActiveIndex((prev) => Math.max(prev - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          if (filtered[activeIndex]) {
            const nameWithoutExt = filtered[activeIndex].name.replace(
              /\.md$/,
              "",
            );
            onSelect(nameWithoutExt);
          }
          break;
        case "Escape":
          e.preventDefault();
          onClose();
          break;
      }
    },
    [filtered, activeIndex, onSelect, onClose],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => {
    const item = listRef.current?.children[activeIndex] as
      | HTMLElement
      | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  if (filtered.length === 0) {
    return (
      <div className="bg-popover absolute bottom-full mb-1 max-h-56 w-full overflow-hidden rounded-lg border shadow-md">
        <p className="text-muted-foreground px-3 py-2 text-xs">
          No plans found
        </p>
      </div>
    );
  }

  return (
    <div className="bg-popover absolute bottom-full mb-1 max-h-56 w-full overflow-y-auto rounded-lg border shadow-md">
      <div ref={listRef}>
        {filtered.map((file, index) => (
          <button
            type="button"
            key={file.path}
            className={cn(
              "hover:bg-accent flex w-full items-start gap-2 px-3 py-1.5 text-left text-xs",
              index === activeIndex && "bg-accent",
            )}
            onMouseEnter={() => setActiveIndex(index)}
            onClick={() => {
              const nameWithoutExt = file.name.replace(/\.md$/, "");
              onSelect(nameWithoutExt);
            }}
          >
            <FileText className="text-muted-foreground size-3 shrink-0" />
            <span className="min-w-0 flex-1 truncate">
              {file.name}
              <span className="text-muted-foreground/60 ml-2">
                {timeAgo(file.lastModified)}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
