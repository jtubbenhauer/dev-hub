/**
 * Regression tests for the session-switch variant race.
 *
 * The chat interface keeps the selected model variant ("reasoning effort") in
 * local state and mirrors it into the chat store per session. Switching
 * sessions runs two effects in sequence: a restore effect that loads the
 * target session's agent/model/variant from the store, and an agent-change
 * effect that applies the newly selected agent's default variant. The
 * agent-change effect must not fire for restore-driven agent changes, and the
 * variant validation must not run against the previous model's variant list.
 */

import { act, render, renderHook, screen } from "@testing-library/react";
import { useEffect, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAgentModelSync } from "@/components/chat/use-agent-model-sync";
import type { OmoSessionSelection } from "@/lib/chat/omo-session-selection";
import type { Agent } from "@/lib/opencode/types";
import { useChatStore } from "@/stores/chat-store";

const primaryAgents = vi.hoisted((): Agent[] => {
  const makeAgent = (name: string): Agent => ({
    name,
    description: name,
    mode: "primary",
    native: false,
    hidden: false,
    topP: 1,
    temperature: 1,
    color: "#000000",
    permission: [],
    options: {},
  });
  return [makeAgent("code"), makeAgent("build")];
});

const modelBindingState = vi.hoisted(() => ({ bindings: {} }));
const activeEngineState = vi.hoisted(() => ({
  value: { engine: "opencode", isLoading: false },
}));
const useAgentsMock = vi.hoisted(() =>
  vi.fn(
    (
      _workspaceId: string | null,
      _engine?: string,
    ): { primaryAgents: Agent[]; isLoading?: boolean } => ({
      primaryAgents,
    }),
  ),
);
const sessionSelectionState = vi.hoisted(() => ({
  value: null as OmoSessionSelection | null,
}));

vi.mock("@/components/chat/agent-selector", () => ({
  useAgents: useAgentsMock,
}));

vi.mock("@/hooks/use-omo-session-selection", () => ({
  useOmoSessionSelection: () => sessionSelectionState.value,
}));

vi.mock("@/hooks/use-active-chat-engine", () => ({
  useActiveChatEngine: () => activeEngineState.value,
}));

vi.mock("@/hooks/use-settings", () => ({
  useModelAgentBindings: () => modelBindingState,
}));

const initialStoreState = useChatStore.getState();
const noVariants: string[] = [];
const noModes: Agent[] = [];
const testModel = { providerID: "provider-a", modelID: "model-a" };
const otherModel = { providerID: "provider-b", modelID: "model-b" };

interface SelectedModel {
  providerID: string;
  modelID: string;
}

interface HarnessProps {
  activeSessionId: string;
  initialModel?: SelectedModel | null;
  variants: string[];
  variantsModel?: SelectedModel | null;
}

function useHarness({
  activeSessionId,
  initialModel = null,
  variants = [],
  variantsModel = null,
}: HarnessProps) {
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<SelectedModel | null>(
    initialModel,
  );
  const [selectedVariant, setSelectedVariant] = useState<string | null>(null);
  const [availableVariants, setAvailableVariants] = useState({
    model: variantsModel,
    values: variants,
  });

  useAgentModelSync({
    activeWorkspaceId: "ws-a",
    activeSessionId,
    selectedAgent,
    setSelectedAgent,
    selectedModel,
    setSelectedModel,
    selectedVariant,
    availableVariants,
    setSelectedVariant,
  });

  return {
    selectedAgent,
    selectedModel,
    selectedVariant,
    setSelectedAgent,
    setAvailableVariants: (values: string[]) => {
      setAvailableVariants({ model: selectedModel, values });
    },
  };
}

const fallbackModel = {
  providerID: "provider-default",
  modelID: "model-default",
};
const noAvailableVariants = { model: null, values: noVariants };

// Plays a ModelSelector that only re-checks when its inputs change. As a child,
// its effect runs before the parent's restore effect in the same commit.
function FallbackModelPicker({
  isReady,
  selectedModel,
  onFallbackModel,
}: {
  isReady: boolean;
  selectedModel: SelectedModel | null;
  onFallbackModel: (model: SelectedModel) => void;
}) {
  useEffect(() => {
    if (isReady && selectedModel === null) onFallbackModel(fallbackModel);
  }, [isReady, onFallbackModel, selectedModel]);
  return null;
}

function ComposerHarness({ isReady }: { isReady: boolean }) {
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<SelectedModel | null>(
    null,
  );
  const [selectedVariant, setSelectedVariant] = useState<string | null>(null);

  useAgentModelSync({
    activeWorkspaceId: "ws-a",
    activeSessionId: "sess-a",
    selectedAgent,
    setSelectedAgent,
    selectedModel,
    setSelectedModel,
    selectedVariant,
    availableVariants: noAvailableVariants,
    setSelectedVariant,
  });

  return (
    <>
      <span>{selectedModel?.modelID ?? "no model"}</span>
      <FallbackModelPicker
        isReady={isReady}
        selectedModel={selectedModel}
        onFallbackModel={setSelectedModel}
      />
    </>
  );
}

function seedWorkspace(input: {
  sessionAgents?: Record<string, string>;
  sessionModels?: Record<string, SelectedModel>;
  sessionVariants?: Record<string, string>;
  activeSessionId?: string;
}) {
  useChatStore.setState({
    activeWorkspaceId: "ws-a",
    activeSessionId: input.activeSessionId ?? "sess-a",
    workspaceStates: {
      "ws-a": {
        sessions: {},
        sessionsLoaded: true,
        messages: {},
        optimisticMessageIds: {},
        sessionStatuses: {},
        permissions: [],
        questions: [],
        todos: {},
        sessionAgents: input.sessionAgents ?? {},
        sessionModels: input.sessionModels ?? {},
        sessionVariants: input.sessionVariants ?? {},
        lastViewedAt: {},
        pinnedSessionIds: new Set(),
        sessionNotes: {},
      },
    },
  });
}

describe("useAgentModelSync", () => {
  beforeEach(() => {
    useChatStore.setState(initialStoreState, true);
    modelBindingState.bindings = {};
    activeEngineState.value = { engine: "opencode", isLoading: false };
    sessionSelectionState.value = null;
    useAgentsMock.mockClear();
    useAgentsMock.mockImplementation(() => ({ primaryAgents }));
  });

  it("loads the open chat's engine agents and waits while the engine is unknown", () => {
    activeEngineState.value = { engine: "omo", isLoading: false };
    seedWorkspace({});

    const { rerender } = renderHook(
      (props: HarnessProps) => useHarness(props),
      { initialProps: { activeSessionId: "sess-a", variants: noVariants } },
    );
    expect(useAgentsMock).toHaveBeenLastCalledWith("ws-a", "omo");

    activeEngineState.value = { engine: "opencode", isLoading: true };
    rerender({ activeSessionId: "sess-a", variants: noVariants });

    expect(useAgentsMock).toHaveBeenLastCalledWith(null, "opencode");
  });

  it("preserves a stored variant when switching to a session with a different agent", () => {
    seedWorkspace({
      sessionAgents: { "sess-a": "code", "sess-b": "build" },
      sessionVariants: { "sess-b": "max" },
    });

    const { result, rerender } = renderHook<
      ReturnType<typeof useHarness>,
      HarnessProps
    >((props: HarnessProps) => useHarness(props), {
      initialProps: { activeSessionId: "sess-a", variants: noVariants },
    });
    expect(result.current.selectedAgent).toBe("code");

    act(() => {
      useChatStore.setState({ activeSessionId: "sess-b" });
    });
    rerender({ activeSessionId: "sess-b", variants: noVariants });

    expect(result.current.selectedAgent).toBe("build");
    expect(result.current.selectedVariant).toBe("max");
    expect(useChatStore.getState().getSessionVariant("sess-b")).toBe("max");
  });

  it("does not clear a freshly restored variant while the previous model's variant list is still showing", () => {
    seedWorkspace({
      sessionAgents: { "sess-a": "code", "sess-b": "code" },
      sessionModels: { "sess-a": testModel, "sess-b": otherModel },
      sessionVariants: { "sess-b": "max" },
    });

    const { result, rerender } = renderHook<
      ReturnType<typeof useHarness>,
      HarnessProps
    >((props: HarnessProps) => useHarness(props), {
      initialProps: {
        activeSessionId: "sess-a",
        initialModel: testModel,
        variants: ["high"],
        variantsModel: testModel,
      },
    });

    act(() => {
      useChatStore.setState({ activeSessionId: "sess-b" });
    });
    rerender({
      activeSessionId: "sess-b",
      initialModel: testModel,
      variants: ["high"],
      variantsModel: testModel,
    });

    expect(result.current.selectedVariant).toBe("max");

    act(() => {
      result.current.setAvailableVariants(["low", "max"]);
    });
    expect(result.current.selectedVariant).toBe("max");
  });

  it("clears the restored variant once the new model's variant list arrives without it", () => {
    seedWorkspace({
      sessionAgents: { "sess-a": "code", "sess-b": "code" },
      sessionModels: { "sess-a": testModel, "sess-b": otherModel },
      sessionVariants: { "sess-b": "max" },
    });

    const { result, rerender } = renderHook(
      (props: HarnessProps) => useHarness(props),
      {
        initialProps: {
          activeSessionId: "sess-a",
          initialModel: testModel,
          variants: ["high"],
          variantsModel: testModel,
        },
      },
    );

    act(() => {
      useChatStore.setState({ activeSessionId: "sess-b" });
    });
    rerender({
      activeSessionId: "sess-b",
      initialModel: testModel,
      variants: ["high"],
      variantsModel: testModel,
    });
    expect(result.current.selectedVariant).toBe("max");

    act(() => {
      result.current.setAvailableVariants(["low"]);
    });
    expect(result.current.selectedVariant).toBeNull();
  });

  it("still resets the variant when the user explicitly changes agents", () => {
    seedWorkspace({
      sessionAgents: { "sess-a": "code" },
      sessionVariants: { "sess-a": "max" },
    });

    const { result } = renderHook((props: HarnessProps) => useHarness(props), {
      initialProps: { activeSessionId: "sess-a", variants: noVariants },
    });
    expect(result.current.selectedVariant).toBe("max");

    act(() => {
      result.current.setSelectedAgent("build");
    });

    expect(result.current.selectedVariant).toBeNull();
    expect(useChatStore.getState().getSessionVariant("sess-a")).toBeNull();
  });

  it("restores the agent model binding when the session has no override", () => {
    modelBindingState.bindings = {
      build: { providerID: "anthropic", modelID: "claude-opus" },
    };
    seedWorkspace({
      sessionAgents: { "sess-a": "build" },
    });

    const { result } = renderHook((props: HarnessProps) => useHarness(props), {
      initialProps: {
        activeSessionId: "sess-a",
        initialModel: { providerID: "openrouter", modelID: "kimi-k3" },
        variants: noVariants,
      },
    });

    expect(result.current.selectedAgent).toBe("build");
    expect(result.current.selectedModel).toEqual({
      providerID: "anthropic",
      modelID: "claude-opus",
    });
  });

  it("clears an invalid restored variant from local and persisted state", () => {
    seedWorkspace({
      sessionAgents: { "sess-a": "code" },
      sessionModels: { "sess-a": testModel },
      sessionVariants: { "sess-a": "max" },
    });

    const { result } = renderHook((props: HarnessProps) => useHarness(props), {
      initialProps: {
        activeSessionId: "sess-a",
        initialModel: testModel,
        variants: ["low"],
        variantsModel: testModel,
      },
    });

    expect(result.current.selectedVariant).toBeNull();
    expect(useChatStore.getState().getSessionVariant("sess-a")).toBeNull();
  });

  describe("an omo chat this browser saved no choice for", () => {
    const haiku = {
      providerID: "anthropic-subscription",
      modelID: "claude-haiku-5-5",
    };

    beforeEach(() => {
      activeEngineState.value = { engine: "omo", isLoading: false };
    });

    it("shows the model and thinking level omo runs the chat with", () => {
      sessionSelectionState.value = { model: haiku, variant: "high" };
      seedWorkspace({});

      const { result } = renderHook(
        (props: HarnessProps) => useHarness(props),
        { initialProps: { activeSessionId: "sess-a", variants: noVariants } },
      );

      expect(result.current.selectedModel).toEqual(haiku);
      expect(result.current.selectedVariant).toBe("high");
    });

    it("applies omo's answer when it arrives after the chat has opened", () => {
      seedWorkspace({});
      const { result, rerender } = renderHook(
        (props: HarnessProps) => useHarness(props),
        { initialProps: { activeSessionId: "sess-a", variants: noVariants } },
      );
      expect(result.current.selectedModel).toBeNull();

      sessionSelectionState.value = { model: haiku, variant: null };
      rerender({ activeSessionId: "sess-a", variants: noVariants });

      expect(result.current.selectedModel).toEqual(haiku);
      expect(result.current.selectedVariant).toBeNull();
    });

    it("still prefers a model and thinking level chosen in this browser", () => {
      sessionSelectionState.value = { model: haiku, variant: "high" };
      seedWorkspace({
        sessionModels: { "sess-a": otherModel },
        sessionVariants: { "sess-a": "low" },
      });

      const { result } = renderHook(
        (props: HarnessProps) => useHarness(props),
        { initialProps: { activeSessionId: "sess-a", variants: noVariants } },
      );

      expect(result.current.selectedModel).toEqual(otherModel);
      expect(result.current.selectedVariant).toBe("low");
    });

    it("restores even when the workspace has no skill modes", () => {
      useAgentsMock.mockImplementation(() => ({
        primaryAgents: noModes,
        isLoading: false,
      }));
      sessionSelectionState.value = { model: haiku, variant: "medium" };
      seedWorkspace({});

      const { result } = renderHook(
        (props: HarnessProps) => useHarness(props),
        {
          initialProps: {
            activeSessionId: "sess-a",
            initialModel: otherModel,
            variants: noVariants,
          },
        },
      );

      expect(result.current.selectedAgent).toBeNull();
      expect(result.current.selectedModel).toEqual(haiku);
      expect(result.current.selectedVariant).toBe("medium");
    });

    it("keeps a fallback model picked in the same commit instead of clearing it", () => {
      useAgentsMock.mockImplementation(() => ({
        primaryAgents: noModes,
        isLoading: true,
      }));
      seedWorkspace({});
      const { rerender } = render(<ComposerHarness isReady={false} />);
      expect(screen.getByText("no model")).toBeInTheDocument();

      useAgentsMock.mockImplementation(() => ({
        primaryAgents: noModes,
        isLoading: false,
      }));
      rerender(<ComposerHarness isReady />);

      expect(screen.getByText("model-default")).toBeInTheDocument();
    });

    it("waits while the mode list is still loading", () => {
      useAgentsMock.mockImplementation(() => ({
        primaryAgents: noModes,
        isLoading: true,
      }));
      sessionSelectionState.value = { model: haiku, variant: "medium" };
      seedWorkspace({});

      const { result } = renderHook(
        (props: HarnessProps) => useHarness(props),
        {
          initialProps: {
            activeSessionId: "sess-a",
            initialModel: otherModel,
            variants: noVariants,
          },
        },
      );

      expect(result.current.selectedModel).toEqual(otherModel);
    });
  });
});
