import { act, render, screen, waitFor } from "@testing-library/react";
import { ModelSelector } from "@/components/chat/model-selector";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const AVAILABLE_MODEL = {
  providerID: "opencode",
  modelID: "kimi-k3",
};

const useModelAllowlistMock = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/use-settings", () => ({
  useModelAllowlist: useModelAllowlistMock,
}));

function deferredResponse() {
  let resolve = (_response: Response) => {};
  const promise = new Promise<Response>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function providerResponse(
  providerID: string,
  providerName: string,
  modelID: string,
  modelName: string,
) {
  return new Response(
    JSON.stringify({
      providers: [
        {
          id: providerID,
          name: providerName,
          models: { [modelID]: { id: modelID, name: modelName } },
        },
      ],
      default: { [providerID]: modelID },
    }),
    { status: 200 },
  );
}

describe("ModelSelector", () => {
  beforeEach(() => {
    useModelAllowlistMock.mockReturnValue({
      allowlist: ["opencode::kimi-k3"],
      isLoading: false,
    });
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

  it("ignores a provider response from the previous workspace", async () => {
    useModelAllowlistMock.mockReturnValue({
      allowlist: [],
      isLoading: false,
    });
    const workspaceAResponse = deferredResponse();
    const workspaceBResponse = deferredResponse();
    vi.mocked(fetch)
      .mockReset()
      .mockReturnValueOnce(workspaceAResponse.promise)
      .mockReturnValueOnce(workspaceBResponse.promise);
    const onModelChange = vi.fn();

    const { rerender } = render(
      <ModelSelector
        workspaceId="workspace-a"
        selectedModel={{ providerID: "provider-a", modelID: "model-a" }}
        onModelChange={onModelChange}
      />,
    );
    rerender(
      <ModelSelector
        workspaceId="workspace-b"
        selectedModel={{ providerID: "provider-b", modelID: "model-b" }}
        onModelChange={onModelChange}
      />,
    );

    await act(async () => {
      workspaceBResponse.resolve(
        providerResponse("provider-b", "Provider B", "model-b", "Model B"),
      );
      await workspaceBResponse.promise;
    });
    expect(await screen.findByText("Provider B / Model B")).toBeInTheDocument();
    onModelChange.mockClear();

    await act(async () => {
      workspaceAResponse.resolve(
        providerResponse("provider-a", "Provider A", "model-a", "Model A"),
      );
      await workspaceAResponse.promise;
    });

    expect(onModelChange).not.toHaveBeenCalled();
    expect(screen.getByText("Provider B / Model B")).toBeInTheDocument();
  });

  it("does not use loaded providers while the next workspace is loading", async () => {
    useModelAllowlistMock.mockReturnValue({
      allowlist: [],
      isLoading: false,
    });
    const workspaceBResponse = deferredResponse();
    vi.mocked(fetch)
      .mockReset()
      .mockResolvedValueOnce(
        providerResponse("provider-a", "Provider A", "model-a", "Model A"),
      )
      .mockReturnValueOnce(workspaceBResponse.promise);
    const onModelChange = vi.fn();

    const { rerender } = render(
      <ModelSelector
        workspaceId="workspace-a"
        selectedModel={{ providerID: "provider-a", modelID: "model-a" }}
        onModelChange={onModelChange}
      />,
    );
    expect(await screen.findByText("Provider A / Model A")).toBeInTheDocument();
    onModelChange.mockClear();

    rerender(
      <ModelSelector
        workspaceId="workspace-b"
        selectedModel={{ providerID: "provider-b", modelID: "model-b" }}
        onModelChange={onModelChange}
      />,
    );

    expect(onModelChange).not.toHaveBeenCalled();
    expect(screen.getByText("Loading models...")).toBeInTheDocument();
  });
});
