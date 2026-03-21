"use client";

import { useState } from "react";
import { GitBranch, Plus, Trash2, Check, ArrowRightLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { GitBranch as GitBranchType } from "@/types";

interface BranchSelectorProps {
  branches: GitBranchType[];
  currentBranch: string;
  onSwitch: (branchName: string) => void;
  onCreate: (branchName: string) => void;
  onDelete: (branchName: string) => void;
  isSwitching: boolean;
}

export function BranchSelector({
  branches,
  currentBranch: _currentBranch,
  onSwitch,
  onCreate,
  onDelete,
  isSwitching,
}: BranchSelectorProps) {
  const [isCreating, setIsCreating] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");

  function handleCreate() {
    const trimmed = newBranchName.trim();
    if (!trimmed) return;
    onCreate(trimmed);
    setNewBranchName("");
    setIsCreating(false);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b px-3 py-2">
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <GitBranch className="size-4" />
          Branches
        </div>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => setIsCreating(!isCreating)}
        >
          <Plus className="size-3.5" />
        </Button>
      </div>

      {/* Create branch form */}
      {isCreating && (
        <div className="flex shrink-0 items-center gap-1.5 border-b px-3 py-2">
          <Input
            value={newBranchName}
            onChange={(event) => setNewBranchName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") handleCreate();
              if (event.key === "Escape") {
                setIsCreating(false);
                setNewBranchName("");
              }
            }}
            placeholder="New branch name..."
            className="h-7 text-xs"
            autoFocus
          />
          <Button
            size="icon-xs"
            onClick={handleCreate}
            disabled={!newBranchName.trim()}
          >
            <Check className="size-3" />
          </Button>
        </div>
      )}

      {/* Branch list */}
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-px p-2">
          {branches.map((branch) => (
            <div
              key={branch.name}
              className={cn(
                "group flex items-center gap-2 rounded-sm px-2 py-1 text-xs",
                branch.current
                  ? "bg-primary/10 text-primary"
                  : "hover:bg-accent/50 cursor-pointer",
              )}
              onClick={() => {
                if (!branch.current && !isSwitching) onSwitch(branch.name);
              }}
            >
              <GitBranch
                className={cn(
                  "size-3 shrink-0",
                  branch.current && "text-primary",
                )}
              />
              <span className="flex-1 truncate font-mono">{branch.name}</span>
              {branch.current && (
                <span className="text-primary/60 text-[10px]">current</span>
              )}
              {!branch.current && (
                <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={(event) => {
                          event.stopPropagation();
                          onSwitch(branch.name);
                        }}
                        disabled={isSwitching}
                      >
                        <ArrowRightLeft className="size-3" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Switch to branch</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        className="hover:text-destructive"
                        onClick={(event) => {
                          event.stopPropagation();
                          onDelete(branch.name);
                        }}
                      >
                        <Trash2 className="size-3" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Delete branch</TooltipContent>
                  </Tooltip>
                </div>
              )}
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
