"use client";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type SettingsTab =
  | "general"
  | "models"
  | "keybindings"
  | "workspace"
  | "integrations"
  | "providers"
  | "about";

export const SETTINGS_TABS: { id: SettingsTab; label: string }[] = [
  { id: "general", label: "General" },
  { id: "models", label: "Models" },
  { id: "keybindings", label: "Keybindings" },
  { id: "workspace", label: "Workspace" },
  { id: "integrations", label: "Integrations" },
  { id: "providers", label: "Providers" },
  { id: "about", label: "About" },
];

interface SettingsNavProps {
  activeTab: SettingsTab;
  onTabChange: (tab: SettingsTab) => void;
}

export function SettingsSidebar({ activeTab, onTabChange }: SettingsNavProps) {
  return (
    <nav className="flex w-44 shrink-0 flex-col gap-1">
      {SETTINGS_TABS.map((tab) => (
        <Button
          key={tab.id}
          variant="ghost"
          size="sm"
          className={cn(
            "justify-start font-normal",
            activeTab === tab.id && "bg-muted font-medium",
          )}
          onClick={() => onTabChange(tab.id)}
        >
          {tab.label}
        </Button>
      ))}
    </nav>
  );
}

export function SettingsMobileNav({
  activeTab,
  onTabChange,
}: SettingsNavProps) {
  return (
    <Select
      value={activeTab}
      onValueChange={(v) => onTabChange(v as SettingsTab)}
    >
      <SelectTrigger className="w-full md:hidden">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {SETTINGS_TABS.map((tab) => (
          <SelectItem key={tab.id} value={tab.id}>
            {tab.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
