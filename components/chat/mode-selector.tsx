"use client";

import { useState } from "react";
import { ChevronsUpDown, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { getOmoSkillName, OMO_NO_MODE_AGENT } from "@/lib/engine/omo-mode";
import { cn } from "@/lib/utils";
import type { Agent } from "@/lib/opencode/types";

const NO_MODE_LABEL = "No mode";

interface ModeSelectorProps {
  modes: Agent[];
  selectedMode: string | null;
  onModeChange: (mode: string) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function ModeSelector({
  modes,
  selectedMode,
  onModeChange,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: ModeSelectorProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const activeMode = modes.find((mode) => mode.name === selectedMode);
  const activeModeLabel = activeMode
    ? getOmoSkillName(activeMode.name)
    : NO_MODE_LABEL;

  const isOpen = controlledOpen !== undefined ? controlledOpen : internalOpen;
  const setIsOpen =
    controlledOnOpenChange !== undefined
      ? controlledOnOpenChange
      : setInternalOpen;

  if (modes.length === 0) return null;

  const selectMode = (mode: string) => {
    onModeChange(mode);
    setIsOpen(false);
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          role="combobox"
          aria-expanded={isOpen}
          aria-label={`Mode: ${activeModeLabel}`}
          className="max-w-[120px] min-w-0 shrink gap-1.5 overflow-hidden text-xs md:max-w-[160px]"
        >
          <span
            className={cn("truncate", !activeMode && "text-muted-foreground")}
          >
            {activeModeLabel}
          </span>
          <ChevronsUpDown className="size-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[200px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search modes..." />
          <CommandList>
            <CommandEmpty>No modes found.</CommandEmpty>
            <CommandGroup heading="Mode">
              <CommandItem
                value={NO_MODE_LABEL}
                onSelect={() => selectMode(OMO_NO_MODE_AGENT)}
              >
                <Check
                  className={cn(
                    "size-3",
                    activeMode ? "opacity-0" : "opacity-100",
                  )}
                />
                <span className="text-muted-foreground">{NO_MODE_LABEL}</span>
              </CommandItem>
              {modes.map((mode) => {
                const isSelected = mode.name === activeMode?.name;
                return (
                  <CommandItem
                    key={mode.name}
                    value={mode.name}
                    title={mode.description}
                    onSelect={() => selectMode(mode.name)}
                  >
                    <Check
                      className={cn(
                        "size-3",
                        isSelected ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <span className="truncate">
                      {getOmoSkillName(mode.name)}
                    </span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
