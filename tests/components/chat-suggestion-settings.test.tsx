import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatSuggestionSettingsCard } from "@/components/settings/chat-suggestion-settings";

const { mockMutate, suggestionSetting } = vi.hoisted(() => ({
  mockMutate: vi.fn(),
  suggestionSetting: { isChatSuggestionsEnabled: true, isLoading: false },
}));

vi.mock("@/hooks/use-settings", () => ({
  useChatSuggestionsSetting: () => suggestionSetting,
  useSettingsMutation: () => ({ mutate: mockMutate, isPending: false }),
  SETTINGS_KEYS: { CHAT_SUGGESTIONS_ENABLED: "chat-suggestions-enabled" },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));

describe("ChatSuggestionSettingsCard", () => {
  beforeEach(() => {
    mockMutate.mockClear();
    suggestionSetting.isChatSuggestionsEnabled = true;
  });

  it("shows suggestions as enabled by default", () => {
    render(<ChatSuggestionSettingsCard />);
    expect(
      screen.getByRole("switch", { name: "Enable reply suggestions" }),
    ).toBeChecked();
  });

  it("saves false when switched off", async () => {
    render(<ChatSuggestionSettingsCard />);
    await userEvent.click(
      screen.getByRole("switch", { name: "Enable reply suggestions" }),
    );
    expect(mockMutate).toHaveBeenCalledWith(
      { key: "chat-suggestions-enabled", value: false },
      expect.anything(),
    );
  });

  it("reflects a disabled setting", () => {
    suggestionSetting.isChatSuggestionsEnabled = false;
    render(<ChatSuggestionSettingsCard />);
    expect(
      screen.getByRole("switch", { name: "Enable reply suggestions" }),
    ).not.toBeChecked();
  });
});
