import { act, render, screen, waitFor } from "@testing-library/react";
import { ModelSelector } from "@/components/chat/model-selector";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const AVAILABLE_MODEL = {
  providerID: "opencode",
  modelID: "kimi-k3",
};

const useModelAllowlistMock = vi.hoisted(() => vi.fn());

const useWorkspaceEngineMock = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/use-settings", () => ({
  useModelAllowlist: useModelAllowlistMock,
}));
vi.mock("@/hooks/use-workspace-engine", () => ({
  useWorkspaceEngine: useWorkspaceEngineMock,
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
    useWorkspaceEngineMock.mockReturnValue({
      engine: "opencode",
      isLoading: false,
    });
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

  it("offers every model in an OmO workspace regardless of the allowlist", async () => {
    useWorkspaceEngineMock.mockReturnValue({ engine: "omo", isLoading: false });
    const onModelChange = vi.fn();

    render(
      <ModelSelector
        workspaceId="omo-workspace"
        selectedModel={{ providerID: "opencode", modelID: "big-pickle" }}
        onModelChange={onModelChange}
      />,
    );

    await waitFor(() =>
      expect(screen.getByRole("combobox")).toHaveTextContent("Big Pickle"),
    );
    await act(async () => {
      screen.getByRole("combobox").click();
    });
    expect(
      await screen.findByRole("option", { name: /Big Pickle/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Kimi K3/ })).toBeInTheDocument();
    expect(onModelChange).not.toHaveBeenCalled();
  });

  it("shows no models in an OpenCode workspace when the allowlist names none", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          providerResponse("other", "Other", "other-model", "Other Model"),
        ),
      ),
    );

    render(
      <ModelSelector
        workspaceId="workspace-1"
        selectedModel={null}
        onModelChange={vi.fn()}
      />,
    );

    expect(await screen.findByText("No models")).toBeInTheDocument();
  });

  it("waits for the engine before choosing a fallback model", async () => {
    useWorkspaceEngineMock.mockReturnValue({
      engine: "opencode",
      isLoading: true,
    });
    const onModelChange = vi.fn();

    render(
      <ModelSelector
        workspaceId="workspace-1"
        selectedModel={null}
        onModelChange={onModelChange}
      />,
    );

    expect(await screen.findByText("Loading models...")).toBeInTheDocument();
    expect(onModelChange).not.toHaveBeenCalled();
  });

  it("still filters to allowlisted models when any are present", async () => {
    const onModelChange = vi.fn();

    render(
      <ModelSelector
        workspaceId="workspace-1"
        selectedModel={{ providerID: "opencode", modelID: "big-pickle" }}
        onModelChange={onModelChange}
      />,
    );

    await waitFor(() =>
      expect(onModelChange).toHaveBeenCalledWith(AVAILABLE_MODEL),
    );
  });

  it("sends an automatic fallback to onFallbackModel without saving it", async () => {
    localStorage.setItem(
      "dev-hub:selected-model",
      JSON.stringify({ providerID: "anthropic", modelID: "claude-opus-4-8" }),
    );
    const onModelChange = vi.fn();
    const onFallbackModel = vi.fn();

    render(
      <ModelSelector
        workspaceId="workspace-1"
        selectedModel={{
          providerID: "anthropic-subscription",
          modelID: "claude-opus-5-5",
        }}
        onModelChange={onModelChange}
        onFallbackModel={onFallbackModel}
      />,
    );

    await waitFor(() =>
      expect(onFallbackModel).toHaveBeenCalledWith(AVAILABLE_MODEL),
    );
    expect(onModelChange).not.toHaveBeenCalled();
    expect(
      JSON.parse(localStorage.getItem("dev-hub:selected-model") ?? "null"),
    ).toEqual({
      providerID: "anthropic",
      modelID: "claude-opus-4-8",
    });
    localStorage.clear();
  });

  it("remembers a manual pick in an OmO workspace under its own key", async () => {
    useWorkspaceEngineMock.mockReturnValue({ engine: "omo", isLoading: false });
    localStorage.setItem(
      "dev-hub:selected-model",
      JSON.stringify({ providerID: "anthropic", modelID: "claude-opus-4-8" }),
    );
    const onModelChange = vi.fn();

    render(
      <ModelSelector
        workspaceId="omo-workspace"
        selectedModel={{ providerID: "opencode", modelID: "big-pickle" }}
        onModelChange={onModelChange}
      />,
    );
    await waitFor(() =>
      expect(screen.getByRole("combobox")).toHaveTextContent("Big Pickle"),
    );
    await act(async () => {
      screen.getByRole("combobox").click();
    });
    await act(async () => {
      (await screen.findByRole("option", { name: /Kimi K3/ })).click();
    });

    expect(onModelChange).toHaveBeenCalledWith(AVAILABLE_MODEL);
    expect(
      JSON.parse(localStorage.getItem("dev-hub:selected-model:omo") ?? "null"),
    ).toEqual(AVAILABLE_MODEL);
    expect(
      JSON.parse(localStorage.getItem("dev-hub:selected-model") ?? "null"),
    ).toEqual({ providerID: "anthropic", modelID: "claude-opus-4-8" });
    localStorage.clear();
  });
});
