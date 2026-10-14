"use client";

import { useId, useRef, useState } from "react";
import { Check, ChevronsUpDown, Shield } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useActiveChatEngine } from "@/hooks/use-active-chat-engine";
import {
  OMO_PERMISSION_PRESET_DETAILS,
  OMO_PERMISSION_PRESETS,
  type OmoPermissionPreset,
} from "@/lib/omo/permission-presets";
import { cn } from "@/lib/utils";
import {
  applyOmoPermissionPreset,
  useOmoPermissionPresetStore,
} from "@/stores/omo-permission-preset-store";

const DEFAULT_PRESET_LABEL = "Default";
const APPLY_PRESET_FALLBACK_ERROR =
  "Couldn't change permissions for this session.";

interface OmoPermissionPresetSelectorProps {
  readonly workspaceId: string;
  readonly sessionId: string | null;
}

export function OmoPermissionPresetSelector({
  workspaceId,
  sessionId,
}: OmoPermissionPresetSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const descriptionIdPrefix = useId();
  const { engine } = useActiveChatEngine(workspaceId);
  const preset: OmoPermissionPreset | undefined = useOmoPermissionPresetStore(
    (state) => state.presetByWorkspace[workspaceId],
  );

  if (engine !== "omo") return null;

  const selectPreset = (nextPreset: OmoPermissionPreset) => {
    useOmoPermissionPresetStore.getState().setPreset(workspaceId, nextPreset);
    setIsOpen(false);
    if (!sessionId) return;
    void applyOmoPermissionPreset(workspaceId, sessionId, nextPreset).catch(
      (error: unknown) => {
        toast.error(
          error instanceof Error ? error.message : APPLY_PRESET_FALLBACK_ERROR,
        );
      },
    );
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          role="combobox"
          aria-expanded={isOpen}
          aria-label="Permission mode"
          className="max-w-[120px] min-w-0 shrink gap-1.5 overflow-hidden text-xs md:max-w-[160px]"
        >
          <Shield className="size-3 shrink-0" />
          <span className="truncate">
            {preset
              ? OMO_PERMISSION_PRESET_DETAILS[preset].label
              : DEFAULT_PRESET_LABEL}
          </span>
          <ChevronsUpDown className="size-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-72 max-w-(--radix-popover-content-available-width) p-0"
        align="start"
        onOpenAutoFocus={(event) => {
          // There is no search input, so focus the listbox itself; otherwise
          // cmdk never receives the arrow and Enter keys.
          event.preventDefault();
          listRef.current?.focus();
        }}
      >
        <Command defaultValue={preset}>
          <CommandList
            ref={listRef}
            className="max-h-(--radix-popover-content-available-height) outline-hidden"
          >
            <CommandGroup heading="Permission mode">
              {OMO_PERMISSION_PRESETS.map((option) => {
                const { label, description } =
                  OMO_PERMISSION_PRESET_DETAILS[option];
                const isSelected = option === preset;
                const descriptionId = `${descriptionIdPrefix}-${option}`;
                return (
                  <CommandItem
                    key={option}
                    value={option}
                    aria-checked={isSelected}
                    aria-describedby={descriptionId}
                    className="items-start"
                    onSelect={() => selectPreset(option)}
                  >
                    <Check
                      className={cn(
                        "mt-1 size-3",
                        isSelected ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span>{label}</span>
                      <span
                        id={descriptionId}
                        aria-hidden
                        className="text-muted-foreground text-xs"
                      >
                        {description}
                      </span>
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
