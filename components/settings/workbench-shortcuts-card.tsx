"use client";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useWorkbenchChordsSetting } from "@/hooks/use-settings";

interface WorkbenchKeyCombo {
  readonly keys: string;
  readonly description: string;
}

// The fixed chords of lib/workbench/workbench-shortcuts.ts (not customizable).
const WORKBENCH_KEY_COMBOS: readonly WorkbenchKeyCombo[] = [
  { keys: "Ctrl+Shift+]", description: "Next tab in the focused group" },
  { keys: "Ctrl+Shift+[", description: "Previous tab in the focused group" },
  {
    keys: "Alt+1 … Alt+9",
    description:
      "Go to tab 1 to 8, or the last tab with 9 (not in text fields)",
  },
  { keys: "Ctrl+Alt+Arrow", description: "Focus the neighbouring group" },
  {
    keys: "Ctrl+Shift+\\",
    description: "Split the focused group to the right",
  },
  { keys: "Cmd/Ctrl+\\", description: "Show or hide the context sidebar" },
];

export function WorkbenchShortcutsCard() {
  const { isEnabled, isSaving, setIsEnabled } = useWorkbenchChordsSetting();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Workbench shortcuts</CardTitle>
        <CardDescription>
          Direct key combos for workbench tabs and splits. They also work inside
          terminals and editors. Alt is Option on macOS.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="workbench-chords-enabled">
            Enable workbench shortcuts
          </Label>
          <Switch
            id="workbench-chords-enabled"
            checked={isEnabled}
            onCheckedChange={setIsEnabled}
            disabled={isSaving}
          />
        </div>
        <ul aria-label="Workbench key combos" className="space-y-1.5">
          {WORKBENCH_KEY_COMBOS.map(({ keys, description }) => (
            <li key={keys} className="flex items-center gap-3 text-sm">
              <Badge
                variant="outline"
                className="w-32 shrink-0 justify-start px-1.5 py-0 font-mono text-xs"
              >
                {keys}
              </Badge>
              <span className="text-muted-foreground">{description}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
