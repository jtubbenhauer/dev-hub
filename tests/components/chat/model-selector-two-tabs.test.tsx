import { render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ChatTabProvider,
  type ChatTabContextValue,
} from "@/components/chat/chat-tab-context";
import { ModelSelector } from "@/components/chat/model-selector";
import { useChatStore } from "@/stores/chat-store";

vi.mock("@/hooks/use-settings", () => ({
  useModelAllowlist: () => ({ allowlist: [], isLoading: false }),
}));
vi.mock("@/hooks/use-workspace-engine", () => ({
  useWorkspaceEngine: () => ({ engine: "opencode", isLoading: false }),
}));

const initialChatState = useChatStore.getState();

const OPENCODE_MODEL = {
  providerID: "opencode-provider",
  modelID: "opencode-model",
};
const OMO_MODEL = { providerID: "omo-provider", modelID: "omo-model" };

function providersResponse(model: typeof OPENCODE_MODEL, label: string) {
  return new Response(
    JSON.stringify({
      providers: [
        {
          id: model.providerID,
          name: `${label} Provider`,
          models: { [model.modelID]: { id: model.modelID, name: label } },
        },
      ],
      default: { [model.providerID]: model.modelID },
    }),
    { status: 200 },
  );
}

function requestedEngine(input: RequestInfo | URL): string | null {
  return new URL(String(input), "http://localhost").searchParams.get("engine");
}

function chatTab(tabId: string, sessionId: string): ChatTabContextValue {
  return {
    tabId,
    workspaceId: "w1",
    sessionId,
    isFocused: false,
    isLastFocusedChat: false,
    isVisible: true,
  };
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) =>
      requestedEngine(input) === "omo"
        ? providersResponse(OMO_MODEL, "Omo Model")
        : providersResponse(OPENCODE_MODEL, "OpenCode Model"),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  useChatStore.setState(initialChatState, true);
});

describe("ModelSelector in two chat tabs of one workspace", () => {
  it.each(["ses_a", "omo_b"])(
    "keeps each tab's model while the focused chat is %s",
    async (globalSessionId) => {
      useChatStore.setState({
        activeWorkspaceId: "w1",
        activeSessionId: globalSessionId,
      });
      const onOpenCodeFallback = vi.fn();
      const onOmoFallback = vi.fn();

      render(
        <>
          <div data-testid="opencode-tab">
            <ChatTabProvider value={chatTab("tab-a", "ses_a")}>
              <ModelSelector
                workspaceId="w1"
                selectedModel={OPENCODE_MODEL}
                onModelChange={vi.fn()}
                onFallbackModel={onOpenCodeFallback}
              />
            </ChatTabProvider>
          </div>
          <div data-testid="omo-tab">
            <ChatTabProvider value={chatTab("tab-b", "omo_b")}>
              <ModelSelector
                workspaceId="w1"
                selectedModel={OMO_MODEL}
                onModelChange={vi.fn()}
                onFallbackModel={onOmoFallback}
              />
            </ChatTabProvider>
          </div>
        </>,
      );

      await waitFor(() => {
        expect(
          within(screen.getByTestId("opencode-tab")).getByRole("combobox"),
        ).toHaveTextContent("OpenCode Model");
        expect(
          within(screen.getByTestId("omo-tab")).getByRole("combobox"),
        ).toHaveTextContent("Omo Model");
      });
      const engines = vi
        .mocked(fetch)
        .mock.calls.map(([input]) => requestedEngine(input));
      expect(engines.sort()).toEqual(["omo", "opencode"]);
      expect(onOpenCodeFallback).not.toHaveBeenCalled();
      expect(onOmoFallback).not.toHaveBeenCalled();
    },
  );
});
