"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { AuthenticatedLayout } from "@/components/layout/authenticated-layout";
import {
  SettingsSidebar,
  SettingsMobileNav,
} from "@/components/settings/settings-nav";
import type { SettingsTab } from "@/components/settings/settings-nav";
import { GeneralSettings } from "@/components/settings/general-settings";
import { ModelSettings } from "@/components/settings/model-settings";
import { KeybindingsSettings } from "@/components/settings/keybindings-settings";
import { WorkspaceSettings } from "@/components/settings/workspace-settings";
import { IntegrationSettings } from "@/components/settings/integration-settings";
import { ProviderSettings } from "@/components/settings/provider-settings";
import { AboutSettings } from "@/components/settings/about-settings";
import { useWorkspaceStore } from "@/stores/workspace-store";

const VALID_TABS: SettingsTab[] = [
  "general",
  "models",
  "keybindings",
  "workspace",
  "integrations",
  "providers",
  "about",
];

function isValidTab(value: string | null): value is SettingsTab {
  return VALID_TABS.includes(value as SettingsTab);
}

function SettingsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawTab = searchParams.get("tab");
  const activeTab: SettingsTab = isValidTab(rawTab) ? rawTab : "general";
  const activeWorkspaceId = useWorkspaceStore(
    (state) => state.activeWorkspaceId,
  );

  const handleTabChange = (tab: SettingsTab) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", tab);
    router.replace(`/settings?${params.toString()}`, { scroll: false });
  };

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6">
      <div className="mx-auto max-w-4xl">
        <div className="mb-6">
          <h1 className="text-2xl font-bold">Settings</h1>
          <p className="text-muted-foreground text-sm">
            Configure models, agent bindings, and preferences.
          </p>
        </div>

        {/* Mobile nav — visible below md breakpoint */}
        <div className="mb-4 md:hidden">
          <SettingsMobileNav
            activeTab={activeTab}
            onTabChange={handleTabChange}
          />
        </div>

        <div className="flex gap-8">
          {/* Sidebar — hidden on mobile */}
          <div className="hidden md:block">
            <SettingsSidebar
              activeTab={activeTab}
              onTabChange={handleTabChange}
            />
          </div>

          {/* Content */}
          <div className="min-w-0 flex-1">
            {activeTab === "general" && <GeneralSettings />}
            {activeTab === "models" && (
              <ModelSettings workspaceId={activeWorkspaceId} />
            )}
            {activeTab === "keybindings" && <KeybindingsSettings />}
            {activeTab === "workspace" && <WorkspaceSettings />}
            {activeTab === "integrations" && <IntegrationSettings />}
            {activeTab === "providers" && <ProviderSettings />}
            {activeTab === "about" && <AboutSettings />}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <AuthenticatedLayout>
      <Suspense>
        <SettingsContent />
      </Suspense>
    </AuthenticatedLayout>
  );
}
