import { render, screen, waitFor } from "@testing-library/react";
import { ModelSelector } from "@/components/chat/model-selector";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const AVAILABLE_MODEL = {
  providerID: "opencode",
  modelID: "kimi-k3",
};

vi.mock("@/hooks/use-settings", () => ({
  useModelAllowlist: vi.fn(() => ({
    allowlist: ["opencode::kimi-k3"],
    isLoading: false,
  })),
}));

describe("ModelSelector", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              providers: [
                {
                  id: "opencode",
                  name: "OpenCode Zen",
                  models: {
                    "big-pickle": {
                      id: "big-pickle",
                      name: "Big Pickle",
                    },
                    "kimi-k3": {
                      id: "kimi-k3",
                      name: "Kimi K3",
                    },
                  },
                },
              ],
              default: { opencode: "big-pickle" },
            }),
            { status: 200 },
          ),
        ),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("replaces a late unavailable agent model with an available model", async () => {
    const onModelChange = vi.fn();
    const { rerender } = render(
      <ModelSelector
        workspaceId="workspace-1"
        selectedModel={AVAILABLE_MODEL}
        onModelChange={onModelChange}
      />,
    );

    expect(
      await screen.findByText("OpenCode Zen / Kimi K3"),
    ).toBeInTheDocument();
    onModelChange.mockClear();

    rerender(
      <ModelSelector
        workspaceId="workspace-1"
        selectedModel={{
          providerID: "anthropic",
          modelID: "claude-opus-5",
        }}
        onModelChange={onModelChange}
      />,
    );

    await waitFor(() => {
      expect(onModelChange).toHaveBeenCalledWith(AVAILABLE_MODEL);
    });
  });
});
