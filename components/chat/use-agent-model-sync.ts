import { useAgents } from "@/components/chat/agent-selector";
import { useModelAgentBindings } from "@/hooks/use-settings";
import { isOmoSkillAgentName } from "@/lib/engine/omo-mode";
import type { Agent } from "@/lib/opencode/types";
import { useChatStore } from "@/stores/chat-store";
import type { Dispatch, SetStateAction } from "react";
import { useEffect, useMemo, useRef } from "react";

interface SelectedModel {
  providerID: string;
  modelID: string;
}

// OmO skill modes are prompt prefixes, never model configurations.
function findAgentModelBinding(
  agentModelBindings: Record<string, SelectedModel>,
  agentName: string,
): SelectedModel | undefined {
  if (isOmoSkillAgentName(agentName)) return undefined;
  return agentModelBindings[agentName];
}

// Skill modes are opt-in, so an omo workspace defaults to "no mode".
function findDefaultAgent(primaryAgents: Agent[]): Agent | undefined {
  return (
    primaryAgents.find((agent) => agent.name === "code") ??
    primaryAgents.find((agent) => !isOmoSkillAgentName(agent.name))
  );
}

interface AvailableVariants {
  model: SelectedModel | null;
  values: string[];
}

interface UseAgentModelSyncArgs {
  activeWorkspaceId: string | null;
  activeSessionId: string | null;
  selectedAgent: string | null;
  setSelectedAgent: Dispatch<SetStateAction<string | null>>;
  selectedModel: SelectedModel | null;
  setSelectedModel: Dispatch<SetStateAction<SelectedModel | null>>;
  selectedVariant: string | null;
  availableVariants: AvailableVariants;
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
  const { model: availableVariantsModel, values: availableVariantValues } =
    availableVariants;

  // Track the previous agent so we only force-set the model when the agent
  // actually changes — not when other deps (primaryAgents, bindings) re-render.
  // This lets the user manually override the model within a session.
  const prevAgentRef = useRef<string | null>(null);

  const isVariantListCurrent =
    selectedModel !== null &&
    availableVariantsModel?.providerID === selectedModel.providerID &&
    availableVariantsModel.modelID === selectedModel.modelID;

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
        const bound = findAgentModelBinding(agentModelBindings, selectedAgent);
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
        isVariantListCurrent &&
        !availableVariantValues.includes(agentVariant)
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
    availableVariantValues,
    isVariantListCurrent,
    selectedModel,
    setSelectedModel,
    setSelectedVariant,
  ]);

  useEffect(() => {
    if (
      selectedVariant &&
      isVariantListCurrent &&
      !availableVariantValues.includes(selectedVariant)
    ) {
      setSelectedVariant(null);
      const {
        activeSessionId: sessionId,
        activeWorkspaceId: workspaceId,
        clearSessionVariant,
      } = useChatStore.getState();
      if (sessionId && workspaceId) {
        clearSessionVariant(sessionId, workspaceId);
      }
    }
  }, [
    availableVariantValues,
    isVariantListCurrent,
    selectedVariant,
    setSelectedVariant,
  ]);

  const { getSessionAgent, getSessionModel, getSessionVariant } =
    useChatStore.getState();

  useEffect(() => {
    if (primaryAgents.length === 0) return;

    const storedAgent = activeSessionId
      ? getSessionAgent(activeSessionId)
      : null;
    const restoredAgentName =
      storedAgent ?? findDefaultAgent(primaryAgents)?.name ?? null;
    const restoredAgent = primaryAgents.find(
      (agent) => agent.name === restoredAgentName,
    );
    // Mark the agent as restored so the agent-change effect above does not
    // treat this as a user change and overwrite session-specific choices.
    prevAgentRef.current = restoredAgentName;
    setSelectedAgent(restoredAgentName);

    const storedModel = activeSessionId
      ? getSessionModel(activeSessionId)
      : null;
    const boundModel =
      restoredAgentName === null
        ? undefined
        : findAgentModelBinding(agentModelBindings, restoredAgentName);
    setSelectedModel(storedModel ?? restoredAgent?.model ?? boundModel ?? null);

    const storedVariant = activeSessionId
      ? getSessionVariant(activeSessionId)
      : null;
    setSelectedVariant(storedVariant ?? restoredAgent?.variant ?? null);
  }, [
    activeSessionId,
    agentModelBindings,
    getSessionAgent,
    getSessionModel,
    getSessionVariant,
    primaryAgents,
    setSelectedAgent,
    setSelectedModel,
    setSelectedVariant,
  ]);

  return { orderedAgents, primaryAgents, agentModelBindings };
}
