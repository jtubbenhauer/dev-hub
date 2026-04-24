import { useAgents } from "@/components/chat/agent-selector";
import { useModelAgentBindings } from "@/hooks/use-settings";
import type { Agent } from "@/lib/opencode/types";
import { useChatStore } from "@/stores/chat-store";
import type { Dispatch, SetStateAction } from "react";
import { useEffect, useMemo, useRef } from "react";

interface SelectedModel {
  providerID: string;
  modelID: string;
}

interface UseAgentModelSyncArgs {
  activeWorkspaceId: string | null;
  activeSessionId: string | null;
  selectedAgent: string | null;
  setSelectedAgent: Dispatch<SetStateAction<string | null>>;
  selectedModel: SelectedModel | null;
  setSelectedModel: Dispatch<SetStateAction<SelectedModel | null>>;
  selectedVariant: string | null;
  availableVariants: string[];
  setSelectedVariant: Dispatch<SetStateAction<string | null>>;
}

interface UseAgentModelSyncResult {
  orderedAgents: Agent[];
  primaryAgents: Agent[];
  agentModelBindings: Record<string, SelectedModel>;
}

export function useAgentModelSync({
  activeWorkspaceId,
  activeSessionId,
  selectedAgent,
  setSelectedAgent,
  selectedModel,
  setSelectedModel,
  selectedVariant,
  availableVariants,
  setSelectedVariant,
}: UseAgentModelSyncArgs): UseAgentModelSyncResult {
  const { primaryAgents } = useAgents(activeWorkspaceId);
  const orderedAgents = useMemo(() => {
    const utilityNames = new Set(["compaction", "title", "summary"]);
    return primaryAgents.filter(
      (agent) => !utilityNames.has(agent.name.toLowerCase()),
    );
  }, [primaryAgents]);

  const { bindings: agentModelBindings } = useModelAgentBindings();

  // Track the previous agent so we only force-set the model when the agent
  // actually changes — not when other deps (primaryAgents, bindings) re-render.
  // This lets the user manually override the model within a session.
  const prevAgentRef = useRef<string | null>(null);

  useEffect(() => {
    if (!selectedAgent || primaryAgents.length === 0) return;

    const agentChanged = prevAgentRef.current !== selectedAgent;
    prevAgentRef.current = selectedAgent;

    const agent = primaryAgents.find((a) => a.name === selectedAgent);

    const { activeSessionId: currentSessionId, getSessionModel: getModel } =
      useChatStore.getState();
    const hasStoredModel = currentSessionId
      ? !!getModel(currentSessionId)
      : false;

    if ((agentChanged || !selectedModel) && !hasStoredModel) {
      if (agent?.model) {
        setSelectedModel(agent.model);
      } else {
        const bound = agentModelBindings[selectedAgent];
        if (bound) setSelectedModel(bound);
      }
    }

    // Agent config can advertise a variant not in the model's variant map → API error
    if (agentChanged) {
      const agentVariant = agent?.variant ?? null;
      const {
        activeSessionId: sid,
        activeWorkspaceId: wsId,
        setSessionVariant: storeVariant,
        clearSessionVariant,
      } = useChatStore.getState();
      if (
        agentVariant &&
        availableVariants.length > 0 &&
        !availableVariants.includes(agentVariant)
      ) {
        setSelectedVariant(null);
        if (sid && wsId) clearSessionVariant(sid, wsId);
      } else {
        setSelectedVariant(agentVariant);
        if (sid && wsId && agentVariant) {
          storeVariant(sid, wsId, agentVariant);
        } else if (sid && wsId) {
          clearSessionVariant(sid, wsId);
        }
      }
    }
  }, [
    selectedAgent,
    primaryAgents,
    agentModelBindings,
    availableVariants,
    selectedModel,
    setSelectedModel,
    setSelectedVariant,
  ]);

  useEffect(() => {
    if (
      selectedVariant &&
      availableVariants.length > 0 &&
      !availableVariants.includes(selectedVariant)
    ) {
      setSelectedVariant(null);
    }
  }, [availableVariants, selectedVariant, setSelectedVariant]);

  const { getSessionAgent, getSessionModel, getSessionVariant } =
    useChatStore.getState();

  useEffect(() => {
    if (primaryAgents.length === 0) return;

    const storedAgent = activeSessionId
      ? getSessionAgent(activeSessionId)
      : null;
    if (storedAgent) {
      setSelectedAgent(storedAgent);
    } else {
      const defaultAgent =
        primaryAgents.find((a) => a.name === "code") ?? primaryAgents[0];
      setSelectedAgent(defaultAgent.name);
    }

    const storedModel = activeSessionId
      ? getSessionModel(activeSessionId)
      : null;
    if (storedModel) {
      setSelectedModel(storedModel);
    }

    const storedVariant = activeSessionId
      ? getSessionVariant(activeSessionId)
      : null;
    if (storedVariant) {
      setSelectedVariant(storedVariant);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionId, primaryAgents]);

  return { orderedAgents, primaryAgents, agentModelBindings };
}
