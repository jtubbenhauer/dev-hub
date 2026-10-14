import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentSelector } from "@/components/chat/agent-selector";
import { ActiveChatEngineBadge } from "@/components/chat/chat-engine-badge";
import { ModelSelector } from "@/components/chat/model-selector";
import { useAgentModelSync } from "@/components/chat/use-agent-model-sync";
import { VariantSelector } from "@/components/chat/variant-selector";
import { workspaceEngineQueryKey } from "@/hooks/use-workspace-engine";
import { OMO_NO_MODE_AGENT } from "@/lib/engine/omo-mode";
import { buildCatalog } from "@/lib/omo/adapter/catalog-shapes";
import { useChatStore } from "@/stores/chat-store";
import { useNewChatEngineStore } from "@/stores/new-chat-engine-store";

interface SelectedModel {
  providerID: string;
  modelID: string;
}

const bindingState = vi.hoisted(() => ({
  bindings: {} as Record<string, SelectedModel>,
}));

vi.mock("@/hooks/use-settings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/use-settings")>();
  return {
    ...actual,
    useModelAgentBindings: () => ({
      bindings: bindingState.bindings,
      isLoading: false,
    }),
  };
});

const OMO_WORKSPACE_ID = "ws-omo";
const OPENCODE_WORKSPACE_ID = "ws-opencode";
const OMO_SESSION_ID = "omo_sess-1";
const OPENCODE_SESSION_ID = "ses_1";
const BOUND_MODEL: SelectedModel = {
  providerID: "anthropic",
  modelID: "claude-opus",
};
const NO_VARIANTS = { model: null, values: [] };

const omoCatalog = buildCatalog({
  models: [
    {
      provider: "anthropic",
      id: "claude-opus",
      name: "Claude Opus",
      thinkingLevels: ["off", "low", "high"],
    },
  ],
  selectedModel: undefined,
  fallbackThinkingLevels: new Map(),
  commandsResponse: {
    type: "response",
    command: "get_commands",
    success: true,
    data: {
      commands: [
        { name: "ulw-plan", description: "Plan the work", source: "skill" },
        {
          name: "start-work",
          description: "Execute a plan",
          source: "extension",
        },
      ],
    },
  },
  surfacesResponse: {
    type: "response",
    command: "get_loaded_surfaces",
    success: true,
    data: { mcpServers: [] },
  },
});

const openCodeAgents = {
  code: {
    name: "code",
    description: "Code",
    mode: "primary",
    permission: [],
    options: {},
  },
  build: {
    name: "build",
    description: "Build",
    mode: "primary",
    permission: [],
    options: {},
  },
};

interface FetchRoutes {
  workspaceEngines: Record<string, string | null>;
  globalEngine?: string;
  agents?: unknown;
  omoAgents?: unknown;
  providers?: unknown;
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function stubFetch(routes: FetchRoutes) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://localhost");
    if (url.pathname === "/api/settings") {
      return jsonResponse(
        routes.globalEngine === undefined
          ? {}
          : { "chat-engine": routes.globalEngine },
      );
    }
    if (url.pathname.startsWith("/api/workspaces/")) {
      const workspaceId = decodeURIComponent(url.pathname.split("/")[3]);
      return jsonResponse({
        id: workspaceId,
        engine: routes.workspaceEngines[workspaceId] ?? null,
      });
    }
    if (url.pathname === "/api/opencode/agent") {
      const agents =
        url.searchParams.get("engine") === "omo"
          ? routes.omoAgents
          : routes.agents;
      return jsonResponse(agents ?? []);
    }
    if (url.pathname === "/api/opencode/config/providers") {
      return jsonResponse(routes.providers ?? { providers: [], default: {} });
    }
    return new Response("not found", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function requestedAgentEngines(fetchMock: ReturnType<typeof stubFetch>) {
  const engines = fetchMock.mock.calls
    .map(([input]) => new URL(String(input), "http://localhost"))
    .filter((url) => url.pathname === "/api/opencode/agent")
    .map((url) => url.searchParams.get("engine"));
  return [...new Set(engines)];
}

function createQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderWithQueryClient(
  ui: ReactNode,
  queryClient = createQueryClient(),
) {
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
    ),
  };
}

interface ChatSelectorsHarnessProps {
  workspaceId: string;
  sessionId: string | null;
}

function ChatSelectorsHarness({
  workspaceId,
  sessionId,
}: ChatSelectorsHarnessProps) {
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<SelectedModel | null>(
    null,
  );
  const [selectedVariant, setSelectedVariant] = useState<string | null>(null);
  const { orderedAgents } = useAgentModelSync({
    activeWorkspaceId: workspaceId,
    activeSessionId: sessionId,
    selectedAgent,
    setSelectedAgent,
    selectedModel,
    setSelectedModel,
    selectedVariant,
    availableVariants: NO_VARIANTS,
    setSelectedVariant,
  });

  return (
    <>
      <AgentSelector
        workspaceId={workspaceId}
        agents={orderedAgents}
        selectedAgent={selectedAgent}
        onAgentChange={(agent) => {
          setSelectedAgent(agent);
          if (sessionId === null) return;
          const { setSessionAgent, clearSessionModel } =
            useChatStore.getState();
          setSessionAgent(sessionId, workspaceId, agent);
          clearSessionModel(sessionId, workspaceId);
        }}
      />
      <output data-testid="selected-model">
        {selectedModel
          ? `${selectedModel.providerID}/${selectedModel.modelID}`
          : "none"}
      </output>
    </>
  );
}

function recordBindingLookups(bindings: Record<string, SelectedModel>) {
  const lookups: string[] = [];
  bindingState.bindings = new Proxy(bindings, {
    get(target, property, receiver) {
      if (typeof property === "string") lookups.push(property);
      return Reflect.get(target, property, receiver);
    },
  });
  return lookups;
}

const initialStoreState = useChatStore.getState();

function openChat(workspaceId: string, sessionId: string | null) {
  useChatStore.setState({
    activeWorkspaceId: workspaceId,
    activeSessionId: sessionId,
  });
}

beforeEach(() => {
  useChatStore.setState(initialStoreState, true);
  useNewChatEngineStore.setState({ engineByWorkspace: {} });
  bindingState.bindings = {};
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("omo Mode selector", () => {
  it("labels the facade's skills as modes and stores the picked mode as the session agent", async () => {
    stubFetch({
      workspaceEngines: { [OMO_WORKSPACE_ID]: "omo" },
      omoAgents: omoCatalog.agents,
    });
    openChat(OMO_WORKSPACE_ID, OMO_SESSION_ID);
    const user = userEvent.setup();

    renderWithQueryClient(
      <ChatSelectorsHarness
        workspaceId={OMO_WORKSPACE_ID}
        sessionId={OMO_SESSION_ID}
      />,
    );

    const trigger = await screen.findByRole("combobox", {
      name: "Mode: No mode",
    });
    expect(trigger).toHaveTextContent("No mode");

    await user.click(trigger);

    expect(await screen.findByText("Mode")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Search modes...")).toBeInTheDocument();
    const modeOption = screen.getByRole("option", { name: "ulw-plan" });
    expect(screen.getByRole("option", { name: "No mode" })).toBeInTheDocument();

    await user.click(modeOption);

    expect(useChatStore.getState().getSessionAgent(OMO_SESSION_ID)).toBe(
      "skill:ulw-plan",
    );
    expect(
      await screen.findByRole("combobox", { name: "Mode: ulw-plan" }),
    ).toBeInTheDocument();
  });

  it("restores a stored skill mode and clears it back to no mode", async () => {
    stubFetch({
      workspaceEngines: { [OMO_WORKSPACE_ID]: "omo" },
      omoAgents: omoCatalog.agents,
    });
    openChat(OMO_WORKSPACE_ID, OMO_SESSION_ID);
    useChatStore
      .getState()
      .setSessionAgent(OMO_SESSION_ID, OMO_WORKSPACE_ID, "skill:ulw-plan");
    const user = userEvent.setup();

    renderWithQueryClient(
      <ChatSelectorsHarness
        workspaceId={OMO_WORKSPACE_ID}
        sessionId={OMO_SESSION_ID}
      />,
    );

    await user.click(
      await screen.findByRole("combobox", { name: "Mode: ulw-plan" }),
    );
    await user.click(await screen.findByRole("option", { name: "No mode" }));

    expect(useChatStore.getState().getSessionAgent(OMO_SESSION_ID)).toBe(
      OMO_NO_MODE_AGENT,
    );
    expect(
      await screen.findByRole("combobox", { name: "Mode: No mode" }),
    ).toBeInTheDocument();
  });

  it("keeps the OpenCode agent picker unchanged for opencode workspaces", async () => {
    stubFetch({
      workspaceEngines: { [OPENCODE_WORKSPACE_ID]: null },
      globalEngine: "opencode",
      agents: openCodeAgents,
    });
    openChat(OPENCODE_WORKSPACE_ID, OPENCODE_SESSION_ID);
    const user = userEvent.setup();

    const { queryClient } = renderWithQueryClient(
      <ChatSelectorsHarness
        workspaceId={OPENCODE_WORKSPACE_ID}
        sessionId={OPENCODE_SESSION_ID}
      />,
    );

    await waitFor(() => {
      expect(
        queryClient.getQueryState(
          workspaceEngineQueryKey(OPENCODE_WORKSPACE_ID),
        )?.status,
      ).toBe("success");
      expect(screen.getByRole("combobox")).toHaveTextContent("code");
    });
    expect(screen.getByRole("combobox")).not.toHaveAttribute("aria-label");

    await user.click(screen.getByRole("combobox"));

    expect(
      await screen.findByPlaceholderText("Search agents..."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Mode")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: "No mode" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("option", { name: "build" }));

    expect(useChatStore.getState().getSessionAgent(OPENCODE_SESSION_ID)).toBe(
      "build",
    );
  });
});

describe("chat selectors with both engines in one workspace", () => {
  it("shows omo modes for an omo chat in an OpenCode workspace", async () => {
    const fetchMock = stubFetch({
      workspaceEngines: { [OPENCODE_WORKSPACE_ID]: null },
      globalEngine: "opencode",
      agents: openCodeAgents,
      omoAgents: omoCatalog.agents,
    });
    openChat(OPENCODE_WORKSPACE_ID, OMO_SESSION_ID);

    renderWithQueryClient(
      <ChatSelectorsHarness
        workspaceId={OPENCODE_WORKSPACE_ID}
        sessionId={OMO_SESSION_ID}
      />,
    );

    expect(
      await screen.findByRole("combobox", { name: "Mode: No mode" }),
    ).toBeInTheDocument();
    expect(requestedAgentEngines(fetchMock)).toEqual(["omo"]);
  });

  it("shows the OpenCode agent picker for an OpenCode chat in an omo workspace", async () => {
    const fetchMock = stubFetch({
      workspaceEngines: { [OMO_WORKSPACE_ID]: "omo" },
      agents: openCodeAgents,
      omoAgents: omoCatalog.agents,
    });
    openChat(OMO_WORKSPACE_ID, OPENCODE_SESSION_ID);

    renderWithQueryClient(
      <ChatSelectorsHarness
        workspaceId={OMO_WORKSPACE_ID}
        sessionId={OPENCODE_SESSION_ID}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole("combobox")).toHaveTextContent("code");
    });
    expect(screen.getByRole("combobox")).not.toHaveAttribute("aria-label");
    expect(requestedAgentEngines(fetchMock)).toEqual(["opencode"]);
  });

  it("uses the engine picked for the next chat before the chat exists", async () => {
    const fetchMock = stubFetch({
      workspaceEngines: { [OPENCODE_WORKSPACE_ID]: null },
      globalEngine: "opencode",
      agents: openCodeAgents,
      omoAgents: omoCatalog.agents,
    });
    openChat(OPENCODE_WORKSPACE_ID, null);
    useNewChatEngineStore
      .getState()
      .setNewChatEngine(OPENCODE_WORKSPACE_ID, "omo");

    renderWithQueryClient(
      <ChatSelectorsHarness
        workspaceId={OPENCODE_WORKSPACE_ID}
        sessionId={null}
      />,
    );

    expect(
      await screen.findByRole("combobox", { name: "Mode: No mode" }),
    ).toBeInTheDocument();
    expect(requestedAgentEngines(fetchMock)).toEqual(["omo"]);
  });
});

describe("useAgentModelSync under omo", () => {
  it("never looks up a model-agent binding for skill modes", async () => {
    const lookups = recordBindingLookups({ "skill:ulw-plan": BOUND_MODEL });
    stubFetch({
      workspaceEngines: { [OMO_WORKSPACE_ID]: "omo" },
      omoAgents: omoCatalog.agents,
    });
    openChat(OMO_WORKSPACE_ID, OMO_SESSION_ID);
    useChatStore
      .getState()
      .setSessionAgent(OMO_SESSION_ID, OMO_WORKSPACE_ID, "skill:ulw-plan");
    const user = userEvent.setup();

    renderWithQueryClient(
      <ChatSelectorsHarness
        workspaceId={OMO_WORKSPACE_ID}
        sessionId={OMO_SESSION_ID}
      />,
    );

    await user.click(
      await screen.findByRole("combobox", { name: "Mode: ulw-plan" }),
    );
    await user.click(await screen.findByRole("option", { name: "No mode" }));
    await user.click(
      await screen.findByRole("combobox", { name: "Mode: No mode" }),
    );
    await user.click(await screen.findByRole("option", { name: "ulw-plan" }));
    await screen.findByRole("combobox", { name: "Mode: ulw-plan" });

    expect(lookups.filter((key) => key.startsWith("skill:"))).toEqual([]);
    expect(screen.getByTestId("selected-model")).toHaveTextContent("none");
  });

  it("still applies model-agent bindings to OpenCode agents", async () => {
    const lookups = recordBindingLookups({ code: BOUND_MODEL });
    stubFetch({
      workspaceEngines: { [OPENCODE_WORKSPACE_ID]: null },
      agents: openCodeAgents,
    });
    openChat(OPENCODE_WORKSPACE_ID, OPENCODE_SESSION_ID);

    renderWithQueryClient(
      <ChatSelectorsHarness
        workspaceId={OPENCODE_WORKSPACE_ID}
        sessionId={OPENCODE_SESSION_ID}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("selected-model")).toHaveTextContent(
        "anthropic/claude-opus",
      );
    });
    expect(lookups).toContain("code");
  });
});

describe("ActiveChatEngineBadge", () => {
  it.each([
    {
      label: "an omo workspace override",
      workspaceEngine: "omo",
      globalEngine: undefined,
    },
    {
      label: "an inherited omo global setting",
      workspaceEngine: null,
      globalEngine: "omo",
    },
  ])(
    "renders the omo badge with no open chat for $label",
    async ({ workspaceEngine, globalEngine }) => {
      stubFetch({
        workspaceEngines: { [OMO_WORKSPACE_ID]: workspaceEngine },
        globalEngine,
      });

      renderWithQueryClient(
        <ActiveChatEngineBadge workspaceId={OMO_WORKSPACE_ID} />,
      );

      const badge = await screen.findByText("omo");
      expect(badge).toHaveAttribute("data-slot", "badge");
      expect(badge).toHaveAttribute("title", "Chat engine: OmO Native");
    },
  );

  it.each([
    {
      label: "the opencode default",
      workspaceEngine: null,
      globalEngine: undefined,
    },
    {
      label: "an opencode global setting",
      workspaceEngine: null,
      globalEngine: "opencode",
    },
    {
      label: "an opencode workspace override of an omo default",
      workspaceEngine: "opencode",
      globalEngine: "omo",
    },
    {
      label: "an invalid workspace override of an omo default",
      workspaceEngine: "bogus",
      globalEngine: "omo",
    },
  ])(
    "renders nothing with no open chat for $label",
    async ({ workspaceEngine, globalEngine }) => {
      stubFetch({
        workspaceEngines: { [OPENCODE_WORKSPACE_ID]: workspaceEngine },
        globalEngine,
      });

      const { container, queryClient } = renderWithQueryClient(
        <ActiveChatEngineBadge workspaceId={OPENCODE_WORKSPACE_ID} />,
      );

      await waitFor(() => {
        expect(
          queryClient.getQueryState(
            workspaceEngineQueryKey(OPENCODE_WORKSPACE_ID),
          )?.status,
        ).toBe("success");
        expect(queryClient.getQueryState(["settings"])?.status).toBe("success");
      });
      expect(screen.queryByText("omo")).not.toBeInTheDocument();
      expect(container).toBeEmptyDOMElement();
    },
  );

  it("renders the omo badge for an omo chat in an OpenCode workspace", async () => {
    stubFetch({
      workspaceEngines: { [OPENCODE_WORKSPACE_ID]: null },
      globalEngine: "opencode",
    });
    openChat(OPENCODE_WORKSPACE_ID, OMO_SESSION_ID);

    renderWithQueryClient(
      <ActiveChatEngineBadge workspaceId={OPENCODE_WORKSPACE_ID} />,
    );

    expect(await screen.findByText("omo")).toHaveAttribute(
      "title",
      "Chat engine: OmO Native",
    );
  });

  it("renders nothing for an OpenCode chat in an omo workspace", async () => {
    stubFetch({ workspaceEngines: { [OMO_WORKSPACE_ID]: "omo" } });
    openChat(OMO_WORKSPACE_ID, OPENCODE_SESSION_ID);

    const { container, queryClient } = renderWithQueryClient(
      <ActiveChatEngineBadge workspaceId={OMO_WORKSPACE_ID} />,
    );

    await waitFor(() => {
      expect(
        queryClient.getQueryState(workspaceEngineQueryKey(OMO_WORKSPACE_ID))
          ?.status,
      ).toBe("success");
    });
    expect(container).toBeEmptyDOMElement();
  });

  it("follows the engine picked for the next chat", async () => {
    stubFetch({
      workspaceEngines: { [OPENCODE_WORKSPACE_ID]: null },
      globalEngine: "opencode",
    });
    useNewChatEngineStore
      .getState()
      .setNewChatEngine(OPENCODE_WORKSPACE_ID, "omo");

    renderWithQueryClient(
      <ActiveChatEngineBadge workspaceId={OPENCODE_WORKSPACE_ID} />,
    );

    expect(await screen.findByText("omo")).toBeInTheDocument();
  });
});

describe("omo thinking levels", () => {
  it("surface as model variants in the unchanged variant selector", async () => {
    stubFetch({
      workspaceEngines: { [OMO_WORKSPACE_ID]: "omo" },
      providers: omoCatalog.providers,
    });
    const onVariantsChange =
      vi.fn<(model: SelectedModel | null, variants: string[]) => void>();
    const user = userEvent.setup();

    const { unmount } = renderWithQueryClient(
      <ModelSelector
        workspaceId={OMO_WORKSPACE_ID}
        selectedModel={BOUND_MODEL}
        onModelChange={vi.fn()}
        onVariantsChange={onVariantsChange}
      />,
    );

    await waitFor(() => {
      expect(onVariantsChange).toHaveBeenLastCalledWith(BOUND_MODEL, [
        "off",
        "low",
        "high",
      ]);
    });
    const emittedVariants = onVariantsChange.mock.lastCall?.[1] ?? [];
    unmount();

    render(
      <VariantSelector
        variants={emittedVariants}
        selectedVariant={null}
        onVariantChange={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("combobox"));

    expect(
      screen.getAllByRole("option").map((option) => option.textContent),
    ).toEqual(["Default", "off", "low", "high"]);
  });
});
