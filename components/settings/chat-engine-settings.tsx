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
  useChatEngineSetting,
} from "@/hooks/use-chat-engine";
import { CHAT_ENGINES, isChatEngine } from "@/lib/engine/types";

export function ChatEngineSettingsCard() {
  const { chatEngine, isLoading } = useChatEngineSetting();
  const mutation = useSettingsMutation();

  const handleEngineChange = (value: string) => {
    if (!isChatEngine(value) || value === chatEngine) return;
    const engineLabel = CHAT_ENGINE_LABELS[value];
    mutation.mutate(
      { key: SETTINGS_KEYS.CHAT_ENGINE, value },
      { onSuccess: () => toast.success(`New chats default to ${engineLabel}`) },
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Chat Engine</CardTitle>
        <CardDescription>
          The engine a new chat starts on when you don&apos;t pick one. A
          workspace can override it from the Workspaces page.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <Label htmlFor="chat-engine">Default engine for new chats</Label>
            <p className="text-muted-foreground text-xs">
              Existing chats keep the engine they started on
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
