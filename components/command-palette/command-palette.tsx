"use client";

import { useRef, useState } from "react";
import {
  buildPaletteEntries,
  groupPaletteEntries,
  rankPaletteGroups,
  type PaletteEntry,
} from "@/components/command-palette/palette-entries";
import { useCommandPalette } from "@/components/providers/command-palette-provider";
import { useLeaderKey } from "@/components/providers/leader-key-provider";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatActivationKey } from "@/lib/leader-key-utils";
import { useRecentPaletteCommandsStore } from "@/stores/recent-palette-commands-store";

const KEY_CAP_CLASS =
  "border-border bg-muted text-muted-foreground inline-flex h-5 min-w-5 items-center justify-center rounded border px-1 font-mono text-[10px]";

function LeaderKeysHint({
  leaderLabel,
  keys,
}: {
  readonly leaderLabel: string;
  readonly keys: readonly string[];
}) {
  return (
    <span className="ml-auto flex shrink-0 items-center gap-0.5">
      <kbd className={KEY_CAP_CLASS}>{leaderLabel}</kbd>
      {keys.map((key, index) => (
        <kbd key={`${index}-${key}`} className={KEY_CAP_CLASS}>
          {key}
        </kbd>
      ))}
    </span>
  );
}

function getFocusedElement(): HTMLElement | null {
  const focused = document.activeElement;
  return focused instanceof HTMLElement && focused !== document.body
    ? focused
    : null;
}

export function CommandPalette() {
  const { isOpen, close, commands } = useCommandPalette();
  const { bindings, activationKey, getRegisteredActions, runAction } =
    useLeaderKey();
  const recentCommandIds = useRecentPaletteCommandsStore(
    (state) => state.recentCommandIds,
  );
  const [search, setSearch] = useState("");
  // Where focus was before opening, for a close that runs no command.
  const focusBeforeOpenRef = useRef<HTMLElement | null>(null);

  // Every opening starts with an empty search (during render)
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (isOpen) setSearch("");
  }

  // Read on every render while open, so it lists what is registered now.
  const groups = isOpen
    ? rankPaletteGroups(
        groupPaletteEntries(
          buildPaletteEntries({
            commands,
            leaderActions: getRegisteredActions(),
            bindings,
            runLeaderAction: runAction,
            search,
            promptForTabNumber: () => setSearch("tab "),
          }),
          recentCommandIds,
        ),
        search,
      )
    : [];
  const leaderLabel = formatActivationKey(activationKey);

  function handleSelect(entry: PaletteEntry) {
    if (entry.keepsPaletteOpen) {
      entry.onSelect();
      return;
    }
    useRecentPaletteCommandsStore.getState().recordCommand(entry.id);
    close();
    // The dialog traps focus until it has closed, so a command that moves
    // focus (into a new chat, onto the next tab) has to run after that.
    window.setTimeout(entry.onSelect, 0);
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && close()}>
      <DialogContent
        className="max-w-lg gap-0 overflow-hidden p-0"
        showCloseButton={false}
        onOpenAutoFocus={() => {
          focusBeforeOpenRef.current = getFocusedElement();
        }}
        onCloseAutoFocus={(event) => {
          // Radix would focus a dialog trigger, and the palette has none.
          event.preventDefault();
          const focusBeforeOpen = focusBeforeOpenRef.current;
          focusBeforeOpenRef.current = null;
          // A command that moved focus keeps it; otherwise focus goes back.
          if (getFocusedElement() === null && focusBeforeOpen?.isConnected) {
            focusBeforeOpen.focus();
          }
        }}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Command palette</DialogTitle>
          <DialogDescription>Search for a command to run</DialogDescription>
        </DialogHeader>
        {/* rankPaletteGroups filters and orders; cmdk only keeps the selection. */}
        <Command loop shouldFilter={false}>
          <CommandInput
            placeholder="Type a command..."
            value={search}
            onValueChange={setSearch}
          />
          <CommandList className="max-h-[min(400px,60vh)]">
            <CommandEmpty>No commands found.</CommandEmpty>
            {groups.map((group) => (
              <CommandGroup key={group.name} heading={group.name}>
                {group.entries.map((entry) => (
                  <CommandItem
                    key={entry.id}
                    value={entry.id}
                    onSelect={() => handleSelect(entry)}
                  >
                    {entry.icon ? (
                      <entry.icon />
                    ) : (
                      <span aria-hidden className="size-4 shrink-0" />
                    )}
                    <span className="truncate">{entry.label}</span>
                    {entry.detail && (
                      <span className="text-muted-foreground truncate font-mono text-xs">
                        {entry.detail}
                      </span>
                    )}
                    {entry.leaderKeys ? (
                      <LeaderKeysHint
                        leaderLabel={leaderLabel}
                        keys={entry.leaderKeys}
                      />
                    ) : (
                      entry.shortcut && (
                        <CommandShortcut>{entry.shortcut}</CommandShortcut>
                      )
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
        <div className="text-muted-foreground/60 flex items-center gap-3 border-t px-3 py-1.5 text-[10px]">
          <span>↑↓ navigate</span>
          <span>↵ run</span>
          <span>esc close</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
