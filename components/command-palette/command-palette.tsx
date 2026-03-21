"use client";

import { useCommandPalette } from "@/components/providers/command-palette-provider";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";

export function CommandPalette() {
  const { isOpen, close, commands } = useCommandPalette();

  const groups = groupByKey(commands, (cmd) => cmd.group);
  const GROUP_ORDER: Record<string, number> = { Workspaces: 0, Navigation: 1 };
  const groupNames = Array.from(groups.keys()).sort(
    (a, b) => (GROUP_ORDER[a] ?? 99) - (GROUP_ORDER[b] ?? 99),
  );

  function handleSelect(onSelect: () => void) {
    close();
    onSelect();
  }

  return (
    <CommandDialog
      open={isOpen}
      onOpenChange={(open) => !open && close()}
      showCloseButton={false}
    >
      <CommandInput placeholder="Type a command..." />
      <CommandList>
        <CommandEmpty>No commands found.</CommandEmpty>
        {groupNames.map((group, groupIndex) => (
          <span key={group}>
            {groupIndex > 0 && <CommandSeparator />}
            <CommandGroup heading={group}>
              {groups.get(group)!.map((cmd) => (
                <CommandItem
                  key={cmd.id}
                  value={`${cmd.group} ${cmd.label}`}
                  onSelect={() => handleSelect(cmd.onSelect)}
                >
                  {cmd.icon && <cmd.icon />}
                  {cmd.label}
                  {cmd.shortcut && (
                    <CommandShortcut>{cmd.shortcut}</CommandShortcut>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </span>
        ))}
      </CommandList>
    </CommandDialog>
  );
}

function groupByKey<T>(
  items: T[],
  keyFn: (item: T) => string,
): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    const existing = map.get(key);
    if (existing) {
      existing.push(item);
    } else {
      map.set(key, [item]);
    }
  }
  return map;
}
