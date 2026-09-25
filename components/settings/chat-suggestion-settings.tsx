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
import { Switch } from "@/components/ui/switch";
import {
  useChatSuggestionsSetting,
  useSettingsMutation,
  SETTINGS_KEYS,
} from "@/hooks/use-settings";

export function ChatSuggestionSettingsCard() {
  const { isChatSuggestionsEnabled, isLoading } = useChatSuggestionsSetting();
  const mutation = useSettingsMutation();

  const handleToggle = (checked: boolean) => {
    mutation.mutate(
      { key: SETTINGS_KEYS.CHAT_SUGGESTIONS_ENABLED, value: checked },
      {
        onSuccess: () =>
          toast.success(
            checked
              ? "Chat reply suggestions enabled"
              : "Chat reply suggestions disabled",
          ),
      },
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Chat Suggestions</CardTitle>
        <CardDescription>
          Suggest replies to the agent as you type. Press → to accept, ⌥→ to
          accept one word, Esc to dismiss.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <Label htmlFor="chat-suggestions-enabled">
              Enable reply suggestions
            </Label>
            <p className="text-muted-foreground text-xs">
              Sends the agent&apos;s latest message and your recent messages to
              the suggestion model (OpenRouter by default)
            </p>
          </div>
          <Switch
            id="chat-suggestions-enabled"
            checked={isChatSuggestionsEnabled}
            onCheckedChange={handleToggle}
            disabled={isLoading || mutation.isPending}
          />
        </div>
      </CardContent>
    </Card>
  );
}
