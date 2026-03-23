import type { Agent } from "@/lib/opencode/types";
import { useChatStore } from "@/stores/chat-store";
import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useRef } from "react";

interface SelectedModel {
  providerID: string;
  modelID: string;
}

interface UseSessionNavigationArgs {
  orderedAgents: Agent[];
  selectedAgent: string | null;
  setSelectedAgent: Dispatch<SetStateAction<string | null>>;
  activeSessionId: string | null;
  activeWorkspaceId: string | null;
  setSelectedModel: Dispatch<SetStateAction<SelectedModel | null>>;
}

interface UseSessionNavigationResult {
  handleModelChange: (model: SelectedModel) => void;
}

export function useSessionNavigation({
  orderedAgents,
  selectedAgent,
  setSelectedAgent,
  activeSessionId,
  activeWorkspaceId,
  setSelectedModel,
}: UseSessionNavigationArgs): UseSessionNavigationResult {
  const { setSessionAgent, setSessionModel } = useChatStore.getState();

  const primaryAgentsRef = useRef(orderedAgents);
  const selectedAgentRef = useRef(selectedAgent);
  const setSelectedAgentRef = useRef(setSelectedAgent);
  const setSessionAgentRef = useRef(setSessionAgent);
  const activeSessionIdRef = useRef(activeSessionId);
  const activeWorkspaceIdRef = useRef(activeWorkspaceId);

  useEffect(() => {
    primaryAgentsRef.current = orderedAgents;
  }, [orderedAgents]);
  useEffect(() => {
    selectedAgentRef.current = selectedAgent;
  }, [selectedAgent]);
  useEffect(() => {
    setSelectedAgentRef.current = setSelectedAgent;
  }, [setSelectedAgent]);
  useEffect(() => {
    setSessionAgentRef.current = setSessionAgent;
  }, [setSessionAgent]);
  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);
  useEffect(() => {
    activeWorkspaceIdRef.current = activeWorkspaceId;
  }, [activeWorkspaceId]);

  const handleModelChange = useCallback(
    (model: SelectedModel) => {
      setSelectedModel(model);
      const sid = activeSessionIdRef.current;
      const wid = activeWorkspaceIdRef.current;
      if (sid && wid) {
        setSessionModel(sid, wid, model);
      }
    },
    [setSelectedModel, setSessionModel],
  );

  useEffect(() => {
    const handleTabCycle = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const agents = primaryAgentsRef.current;
      if (agents.length < 2) return;

      const target = e.target as HTMLElement | null;
      const inChat = target?.closest("[data-chat-interface]");
      if (!inChat) return;

      e.preventDefault();

      const currentIdx = agents.findIndex(
        (a) => a.name === selectedAgentRef.current,
      );
      const nextIdx = e.shiftKey
        ? (currentIdx - 1 + agents.length) % agents.length
        : (currentIdx + 1) % agents.length;
      const nextAgent = agents[nextIdx].name;

      setSelectedAgentRef.current(nextAgent);
      const sessionId = activeSessionIdRef.current;
      const workspaceId = activeWorkspaceIdRef.current;
      if (sessionId && workspaceId) {
        setSessionAgentRef.current(sessionId, workspaceId, nextAgent);
      }
    };

    window.addEventListener("keydown", handleTabCycle);
    return () => window.removeEventListener("keydown", handleTabCycle);
  }, []);

  return { handleModelChange };
}
