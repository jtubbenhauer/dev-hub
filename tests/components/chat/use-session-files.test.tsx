import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSessionFiles } from "@/components/chat/use-session-files";
import { SessionFilesPanel } from "@/components/chat/session-files-panel";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { MessageWithParts, Session } from "@/lib/opencode/types";

const WORKSPACE_ID = "workspace-1";

interface FakeChatState {
  activeSessionId: string | null;
  workspaceStates: Record<
    string,
    | {
        sessions: Record<string, Session>;
        messages: Record<string, MessageWithParts[]>;
      }
    | undefined
  >;
  hasMoreBeforeBySession: Record<string, boolean>;
  fetchMessages: (
    sessionId: string,
    workspaceId: string,
    options?: { force?: boolean },
  ) => Promise<void>;
}

interface FakeWorkspaceState {
  activeWorkspaceId: string | null;
}

let chatState: FakeChatState;
let workspaceState: FakeWorkspaceState;
const fetchMessagesSpy =
  vi.fn<
    (
      sessionId: string,
      workspaceId: string,
      options?: { force?: boolean },
    ) => Promise<void>
  >();

vi.mock("@/stores/chat-store", () => ({
  useChatStore: (selector: (state: FakeChatState) => unknown) =>
    selector(chatState),
}));

vi.mock("@/stores/workspace-store", () => ({
  useWorkspaceStore: (selector: (state: FakeWorkspaceState) => unknown) =>
    selector(workspaceState),
}));

// Panel-only dependencies (only exercised when FileRow renders).
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => false,
}));
vi.mock("@/hooks/use-settings", () => ({
  useChatFileOpenSetting: () => ({ fileOpenMode: "sidebar", isLoading: false }),
}));
vi.mock("@/lib/side-panel-open-file", () => ({
  openFileInSidePanel: vi.fn(),
}));

function makeSession(id: string, parentID: string, created: number): Session {
  return {
    id,
    parentID,
    title: id,
    version: "0.0.0",
    time: { created, updated: created },
  } as unknown as Session;
}

function makeToolMessage(options: {
  sessionID: string;
  messageID: string;
  tool: string;
  filePath: string;
}): MessageWithParts {
  const { sessionID, messageID, tool, filePath } = options;
  return {
    info: {
      id: messageID,
      sessionID,
      role: "assistant",
      time: { created: 1 },
      parentID: "",
      modelID: "",
      providerID: "",
      mode: "",
      path: { cwd: "/workspace", root: "/workspace" },
      cost: 0,
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
    },
    parts: [
      {
        id: `${messageID}-part`,
        sessionID,
        messageID,
        type: "tool",
        callID: `${messageID}-call`,
        tool,
        state: {
          status: "completed" as const,
          input: { filePath },
          output: "",
          title: "",
          metadata: {},
          time: { start: 1, end: 2 },
        },
      },
    ],
  } as unknown as MessageWithParts;
}

beforeEach(() => {
  fetchMessagesSpy.mockReset();
  fetchMessagesSpy.mockResolvedValue(undefined);
  workspaceState = { activeWorkspaceId: WORKSPACE_ID };
  chatState = {
    activeSessionId: "parent",
    workspaceStates: {
      [WORKSPACE_ID]: { sessions: {}, messages: {} },
    },
    hasMoreBeforeBySession: {},
    fetchMessages: fetchMessagesSpy,
  };
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("useSessionFiles", () => {
  it("1. parent-only fixture matches current single-stream behavior", () => {
    const parentMessages = [
      makeToolMessage({
        sessionID: "parent",
        messageID: "m1",
        tool: "write",
        filePath: "/workspace/src/a.ts",
      }),
    ];
    chatState.workspaceStates[WORKSPACE_ID] = {
      sessions: { parent: makeSession("parent", "", 1) },
      messages: { parent: parentMessages },
    };

    const { result } = renderHook(() => useSessionFiles(parentMessages));

    expect(result.current.files).toHaveLength(1);
    expect(result.current.files[0]).toMatchObject({
      path: "/workspace/src/a.ts",
      action: "created",
    });
    expect(result.current.hasUnloadedHistory).toBe(false);
    expect(fetchMessagesSpy).not.toHaveBeenCalled();
  });

  it("2. child edit part contributes a file, deduped with parent", () => {
    const parentMessages = [
      makeToolMessage({
        sessionID: "parent",
        messageID: "m1",
        tool: "write",
        filePath: "/workspace/src/a.ts",
      }),
    ];
    const childMessages = [
      makeToolMessage({
        sessionID: "child",
        messageID: "c1",
        tool: "edit",
        filePath: "/workspace/src/a.ts",
      }),
      makeToolMessage({
        sessionID: "child",
        messageID: "c2",
        tool: "edit",
        filePath: "/workspace/src/b.ts",
      }),
    ];
    chatState.workspaceStates[WORKSPACE_ID] = {
      sessions: {
        parent: makeSession("parent", "", 1),
        child: makeSession("child", "parent", 2),
      },
      messages: { parent: parentMessages, child: childMessages },
    };
    // Boolean sentinel => already loaded, no refetch triggered.
    chatState.hasMoreBeforeBySession = { [`${WORKSPACE_ID}:child`]: false };

    const { result } = renderHook(() => useSessionFiles(parentMessages));

    const paths = result.current.files.map((f) => f.path).sort();
    expect(paths).toEqual(["/workspace/src/a.ts", "/workspace/src/b.ts"]);
    const fileA = result.current.files.find(
      (f) => f.path === "/workspace/src/a.ts",
    );
    // created (parent write) wins over modified (child edit) by priority.
    expect(fileA?.action).toBe("created");
    expect(fetchMessagesSpy).not.toHaveBeenCalled();
  });

  it("3. pre-seeded empty child with no sentinel -> fetch with force:true", () => {
    chatState.workspaceStates[WORKSPACE_ID] = {
      sessions: {
        parent: makeSession("parent", "", 1),
        child: makeSession("child", "parent", 2),
      },
      messages: { parent: [], child: [] },
    };

    renderHook(() => useSessionFiles([]));

    expect(fetchMessagesSpy).toHaveBeenCalledWith("child", WORKSPACE_ID, {
      force: true,
    });
  });

  it("4. streaming-partial child (non-empty, no sentinel) -> fetch with force:true", () => {
    const childMessages = [
      makeToolMessage({
        sessionID: "child",
        messageID: "c1",
        tool: "edit",
        filePath: "/workspace/src/partial.ts",
      }),
    ];
    chatState.workspaceStates[WORKSPACE_ID] = {
      sessions: {
        parent: makeSession("parent", "", 1),
        child: makeSession("child", "parent", 2),
      },
      messages: { parent: [], child: childMessages },
    };

    renderHook(() => useSessionFiles([]));

    expect(fetchMessagesSpy).toHaveBeenCalledWith("child", WORKSPACE_ID, {
      force: true,
    });
  });

  it("5. boolean sentinel present -> child is not fetched", () => {
    chatState.workspaceStates[WORKSPACE_ID] = {
      sessions: {
        parent: makeSession("parent", "", 1),
        child: makeSession("child", "parent", 2),
      },
      messages: { parent: [], child: [] },
    };
    chatState.hasMoreBeforeBySession = { [`${WORKSPACE_ID}:child`]: false };

    renderHook(() => useSessionFiles([]));

    expect(fetchMessagesSpy).not.toHaveBeenCalled();
  });

  it("6. fetchMessages called exactly once per descendant across re-renders", () => {
    chatState.workspaceStates[WORKSPACE_ID] = {
      sessions: {
        parent: makeSession("parent", "", 1),
        child: makeSession("child", "parent", 2),
      },
      messages: { parent: [], child: [] },
    };

    const { rerender } = renderHook(() => useSessionFiles([]));
    rerender();
    rerender();

    expect(fetchMessagesSpy).toHaveBeenCalledTimes(1);
    expect(fetchMessagesSpy).toHaveBeenCalledWith("child", WORKSPACE_ID, {
      force: true,
    });
  });

  it("7. context reset: switching parent refetches and does not accumulate ids", () => {
    chatState.workspaceStates[WORKSPACE_ID] = {
      sessions: {
        p1: makeSession("p1", "", 1),
        c1: makeSession("c1", "p1", 2),
        p2: makeSession("p2", "", 3),
        c2: makeSession("c2", "p2", 4),
      },
      messages: { p1: [], c1: [], p2: [], c2: [] },
    };
    chatState.activeSessionId = "p1";

    const { rerender } = renderHook(() => useSessionFiles([]));
    expect(fetchMessagesSpy).toHaveBeenCalledWith("c1", WORKSPACE_ID, {
      force: true,
    });

    chatState.activeSessionId = "p2";
    rerender();
    expect(fetchMessagesSpy).toHaveBeenCalledWith("c2", WORKSPACE_ID, {
      force: true,
    });

    // Returning to p1 must refetch c1 — proving the request set was reset,
    // not accumulated across contexts.
    fetchMessagesSpy.mockClear();
    chatState.activeSessionId = "p1";
    rerender();
    expect(fetchMessagesSpy).toHaveBeenCalledWith("c1", WORKSPACE_ID, {
      force: true,
    });
  });

  it("8. 25 descendants -> only 20 fetched and hasUnloadedHistory is true", () => {
    const sessions: Record<string, Session> = {
      parent: makeSession("parent", "", 0),
    };
    const messages: Record<string, MessageWithParts[]> = { parent: [] };
    for (let i = 0; i < 25; i++) {
      const id = `child-${i}`;
      sessions[id] = makeSession(id, "parent", i + 1);
      messages[id] = [];
    }
    chatState.workspaceStates[WORKSPACE_ID] = { sessions, messages };

    const { result } = renderHook(() => useSessionFiles([]));

    expect(fetchMessagesSpy).toHaveBeenCalledTimes(20);
    expect(result.current.hasUnloadedHistory).toBe(true);
  });

  it("9. descendant hasMoreBefore=true -> hasUnloadedHistory is true", () => {
    chatState.workspaceStates[WORKSPACE_ID] = {
      sessions: {
        parent: makeSession("parent", "", 1),
        child: makeSession("child", "parent", 2),
      },
      messages: { parent: [], child: [] },
    };
    // Boolean true => loaded AND more history exists upstream.
    chatState.hasMoreBeforeBySession = { [`${WORKSPACE_ID}:child`]: true };

    const { result } = renderHook(() => useSessionFiles([]));

    expect(result.current.hasUnloadedHistory).toBe(true);
    expect(fetchMessagesSpy).not.toHaveBeenCalled();
  });

  it("failure-path: missing session map -> parent-only files, no throw", () => {
    chatState.workspaceStates = {};
    const parentMessages = [
      makeToolMessage({
        sessionID: "parent",
        messageID: "m1",
        tool: "write",
        filePath: "/workspace/src/only.ts",
      }),
    ];

    const run = () => renderHook(() => useSessionFiles(parentMessages));
    expect(run).not.toThrow();

    const { result } = run();
    expect(result.current.files.map((f) => f.path)).toEqual([
      "/workspace/src/only.ts",
    ]);
    expect(result.current.hasUnloadedHistory).toBe(false);
    expect(fetchMessagesSpy).not.toHaveBeenCalled();
  });
});

describe("SessionFilesPanel unloaded-history hint", () => {
  it("10. renders hint with empty files and does not return null", () => {
    chatState.workspaceStates[WORKSPACE_ID] = {
      sessions: { parent: makeSession("parent", "", 1) },
      messages: { parent: [] },
    };
    chatState.hasMoreBeforeBySession = { [`${WORKSPACE_ID}:parent`]: true };

    render(
      <TooltipProvider>
        <SessionFilesPanel messages={[]} workspacePath="/workspace" />
      </TooltipProvider>,
    );

    expect(
      screen.getByTestId("session-files-unloaded-hint"),
    ).toBeInTheDocument();
  });
});

describe("scope check", () => {
  // The worktree is shared across concurrent tasks, so a raw `git status`
  // baseline is polluted by unrelated in-flight edits. Instead we assert the
  // hard MUST-NOT directly: this task's wiring (useSessionFiles) lives ONLY in
  // session-files-panel.tsx and never leaks into side-panel.tsx or
  // chat-interface.tsx.
  const readSource = (relativePath: string): string =>
    readFileSync(join(process.cwd(), relativePath), "utf8");

  it("11. wiring is confined to session-files-panel and forbidden files are untouched", () => {
    const panel = readSource("components/chat/session-files-panel.tsx");
    expect(panel).toContain("useSessionFiles");

    for (const forbidden of [
      "components/chat/side-panel.tsx",
      "components/chat/chat-interface.tsx",
    ]) {
      const source = readSource(forbidden);
      expect(source).not.toContain("useSessionFiles");
      expect(source).not.toContain("use-session-files");
      expect(source).not.toContain("descendant-sessions");
    }
  });
});
