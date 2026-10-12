"use client";

import { toast } from "sonner";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  SETTINGS_KEYS,
  useCodeLensSetting,
  useMinimapSetting,
  useSettingsMutation,
} from "@/hooks/use-settings";

export function EditorSettingsSection() {
  const { isCodeLensEnabled } = useCodeLensSetting();
  const { isMinimapEnabled } = useMinimapSetting();
  const mutation = useSettingsMutation();

  const handleCodeLensToggle = (checked: boolean) => {
    mutation.mutate(
      { key: SETTINGS_KEYS.CODE_LENS_ENABLED, value: checked },
      {
        onSuccess: () =>
          toast.success(`Code lens ${checked ? "enabled" : "disabled"}`),
      },
    );
  };

  const handleMinimapToggle = (checked: boolean) => {
    mutation.mutate(
      { key: SETTINGS_KEYS.MINIMAP_ENABLED, value: checked },
      {
        onSuccess: () =>
          toast.success(`Minimap ${checked ? "enabled" : "disabled"}`),
      },
    );
  };

  return (
    <>
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-0.5">
          <Label htmlFor="editor-code-lens">Code lens</Label>
          <p className="text-muted-foreground text-xs">
            Show reference and implementation counts above functions and
            classes. Uses extra language-server work while you type; Find
            References gives the same information.
          </p>
        </div>
        <Switch
          id="editor-code-lens"
          checked={isCodeLensEnabled}
          onCheckedChange={handleCodeLensToggle}
          disabled={mutation.isPending}
        />
      </div>

      <div className="flex items-center justify-between gap-4">
        <div className="space-y-0.5">
          <Label htmlFor="editor-minimap">Minimap</Label>
          <p className="text-muted-foreground text-xs">
            Show the code overview on the right edge of the editor (desktop
            only).
          </p>
        </div>
        <Switch
          id="editor-minimap"
          checked={isMinimapEnabled}
          onCheckedChange={handleMinimapToggle}
          disabled={mutation.isPending}
        />
      </div>
    </>
  );
}
