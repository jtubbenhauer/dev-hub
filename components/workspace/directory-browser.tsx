"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Folder,
  FolderGit2,
  GitFork,
  ChevronUp,
  ArrowRight,
  Package,
  Loader2,
  Home,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface BrowseEntry {
  name: string;
  path: string;
  isGitRepo: boolean;
  isWorktree: boolean;
  hasPackageJson: boolean;
}

interface BrowseResponse {
  currentPath: string;
  parentPath: string;
  isRoot: boolean;
  entries: BrowseEntry[];
}

interface DirectoryBrowserProps {
  onSelect: (path: string) => void;
  initialPath?: string;
}

export function DirectoryBrowser({
  onSelect,
  initialPath,
}: DirectoryBrowserProps) {
  const [browsePath, setBrowsePath] = useState(initialPath ?? "");
  const [pathInput, setPathInput] = useState("");
  const [data, setData] = useState<BrowseResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const fetchDirectory = useCallback(async (targetPath: string) => {
    setLoading(true);
    setError("");
    try {
      const params = targetPath
        ? `?path=${encodeURIComponent(targetPath)}`
        : "";
      const res = await fetch(`/api/files/browse${params}`);
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || "Failed to browse");
        return;
      }
      const result: BrowseResponse = await res.json();
      setData(result);
      setPathInput(result.currentPath);
      setBrowsePath(result.currentPath);
    } catch {
      setError("Failed to browse directory");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDirectory(initialPath ?? "");
  }, [fetchDirectory, initialPath]);

  function handleNavigate(targetPath: string) {
    fetchDirectory(targetPath);
  }

  function handlePathSubmit() {
    if (pathInput.trim()) {
      fetchDirectory(pathInput.trim());
    }
  }

  function handleEntryDoubleClick(entry: BrowseEntry) {
    handleNavigate(entry.path);
  }

  function getEntryIcon(entry: BrowseEntry) {
    if (entry.isWorktree)
      return <GitFork className="h-4 w-4 shrink-0 text-purple-500" />;
    if (entry.isGitRepo)
      return <FolderGit2 className="h-4 w-4 shrink-0 text-orange-500" />;
    return <Folder className="text-muted-foreground h-4 w-4 shrink-0" />;
  }

  return (
    <div className="flex min-w-0 flex-col gap-3 overflow-hidden">
      {/* Path input bar */}
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="icon"
          className="shrink-0"
          onClick={() => fetchDirectory("")}
          title="Home directory"
        >
          <Home className="h-4 w-4" />
        </Button>
        <Input
          value={pathInput}
          onChange={(e) => setPathInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handlePathSubmit();
          }}
          placeholder="/path/to/directory"
          className="min-w-0 font-mono text-sm"
        />
        <Button
          variant="outline"
          size="icon"
          className="shrink-0"
          onClick={handlePathSubmit}
          title="Go to path"
        >
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>

      {error && (
        <div className="bg-destructive/10 text-destructive rounded-md p-2 text-sm">
          {error}
        </div>
      )}

      {/* Directory listing */}
      <ScrollArea className="h-[300px] rounded-md border">
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
          </div>
        ) : data ? (
          <div className="p-1">
            {/* Parent directory */}
            {!data.isRoot && (
              <button
                onClick={() => handleNavigate(data.parentPath)}
                className="hover:bg-accent flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm"
              >
                <ChevronUp className="text-muted-foreground h-4 w-4 shrink-0" />
                <span className="text-muted-foreground">..</span>
              </button>
            )}

            {data.entries.length === 0 ? (
              <div className="text-muted-foreground flex items-center justify-center py-8 text-sm">
                No subdirectories
              </div>
            ) : (
              data.entries.map((entry) => (
                <button
                  key={entry.path}
                  onClick={() => handleNavigate(entry.path)}
                  onDoubleClick={() => handleEntryDoubleClick(entry)}
                  className={cn(
                    "hover:bg-accent group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
                    (entry.isGitRepo || entry.isWorktree) && "font-medium",
                  )}
                >
                  {getEntryIcon(entry)}
                  <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                  <div className="flex shrink-0 items-center gap-1">
                    {entry.hasPackageJson && (
                      <span title="Has package.json">
                        <Package className="h-3 w-3 text-green-500" />
                      </span>
                    )}
                    {(entry.isGitRepo || entry.isWorktree) && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-xs opacity-0 group-hover:opacity-100"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelect(entry.path);
                        }}
                      >
                        Select
                      </Button>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        ) : null}
      </ScrollArea>

      {/* Select current directory button */}
      <Button
        onClick={() => onSelect(browsePath)}
        disabled={!browsePath}
        className="w-full"
      >
        Select Current Directory
        <span className="ml-2 max-w-[200px] truncate font-mono text-xs opacity-70">
          {browsePath}
        </span>
      </Button>
    </div>
  );
}
