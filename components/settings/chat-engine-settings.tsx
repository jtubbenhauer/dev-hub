"use client";

import { toast } from "sonner";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useSettingsMutation,
  SETTINGS_KEYS,
  DEFAULT_CHAT_ENGINE,
} from "@/hooks/use-settings";
import {
  CHAT_ENGINE_LABELS,
  getWorkspaceEngineOverride,
  purgeAndResetWorkspaceChats,
  useChatEngineSetting,
} from "@/hooks/use-chat-engine";
import {
  CHAT_ENGINES,
  isChatEngine,
  type ChatEngine,
} from "@/lib/engine/types";
import { useWorkspaceStore } from "@/stores/workspace-store";

export function ChatEngineSettingsCard() {
  const { chatEngine, isLoading } = useChatEngineSetting();
  const mutation = useSettingsMutation();

  const switchDefaultEngine = async (nextEngine: ChatEngine) => {
    try {
      await mutation.mutateAsync({
        key: SETTINGS_KEYS.CHAT_ENGINE,
        value: nextEngine,
      });
    } catch {
      return;
    }
    const inheritingWorkspaceIds = useWorkspaceStore
      .getState()
      .workspaces.filter(
        (workspace) => getWorkspaceEngineOverride(workspace) === null,
      )
      .map((workspace) => workspace.id);
    const failedWorkspaceIds = await purgeAndResetWorkspaceChats(
      inheritingWorkspaceIds,
    );
    toast.success(`Chat engine set to ${CHAT_ENGINE_LABELS[nextEngine]}`);
    if (failedWorkspaceIds.length > 0) {
      toast.error(
        `Could not clear cached chat sessions for ${failedWorkspaceIds.length} workspace(s)`,
      );
    }
  };

  const handleEngineChange = (value: string) => {
    if (!isChatEngine(value) || value === chatEngine) return;
    void switchDefaultEngine(value);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Chat Engine</CardTitle>
        <CardDescription>
          The engine that runs chat sessions. A workspace can override it from
          the Workspaces page.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <Label htmlFor="chat-engine">Chat engine</Label>
            <p className="text-muted-foreground text-xs">
              Switching clears cached chat sessions for workspaces that use the
              default
            </p>
          </div>
          <Select
            value={chatEngine}
            onValueChange={handleEngineChange}
            disabled={isLoading || mutation.isPending}
          >
            <SelectTrigger id="chat-engine" className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CHAT_ENGINES.map((engine) => (
                <SelectItem key={engine} value={engine}>
                  {CHAT_ENGINE_LABELS[engine]}
                  {engine === DEFAULT_CHAT_ENGINE ? " (default)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardContent>
    </Card>
  );
}
