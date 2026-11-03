import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  PermissionRequest,
  Session,
  SessionStatus,
} from "@/lib/opencode/types";
import type { Workspace } from "@/types";
import { playSoundForEvent, type SoundEventType } from "@/lib/sounds";
import { showBrowserNotification } from "@/lib/notifications";
import { requestGitStatusRefresh } from "@/lib/git/git-status-refresh";
import { createWorkbenchHref } from "@/lib/workbench/workbench-href";
import {
  _resetModuleCaches,
  resetTurnCompletionTracker,
  useChatStore,
  type WorkspaceState,
} from "@/stores/chat-store";
import { useAttentionStore } from "@/stores/attention-store";
import { useWorkspaceStore } from "@/stores/workspace-store";

vi.mock("@/lib/sounds", () => ({ playSoundForEvent: vi.fn() }));
vi.mock("@/lib/notifications", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/notifications")>()),
  showBrowserNotification: vi.fn(),
}));
vi.mock("@/lib/git/git-status-refresh", () => ({
  requestGitStatusRefresh: vi.fn(),
}));

const WS = "ws-1";
const ROOT_FINISHED_TAG = "devhub-finished-sess-root";
const BUSY: SessionStatus = { type: "busy" };
const IDLE: SessionStatus = { type: "idle" };

let statusMap: Record<string, SessionStatus> = {};
let omoStatusMap: Record<string, SessionStatus> = {};
let omoStatusFails = false;
let remoteSessions: Record<string, unknown> = {};
let statusResponseGate: Promise<void> | null = null;
let isSessionLookupRejected = false;

function toUrl(input: RequestInfo | URL): URL {
  const href =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  return new URL(href, "http://localhost");
}

const fetchMock = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
  const url = toUrl(input);
  if (url.pathname.endsWith("/session/status")) {
    if (statusResponseGate) await statusResponseGate;
    if (url.searchParams.get("engine") === "omo") {
      return omoStatusFails
        ? new Response(null, { status: 503 })
        : Response.json(omoStatusMap);
    }
    return Response.json(statusMap);
  }
  const sessionPath = /^\/api\/opencode\/session\/([^/]+)$/.exec(url.pathname);
  if (sessionPath) {
    if (isSessionLookupRejected) throw new TypeError("network down");
    const remoteSession = remoteSessions[sessionPath[1]];
    return remoteSession
      ? Response.json(remoteSession)
      : new Response(null, { status: 404 });
  }
  return Response.json([]);
});

interface Deferred {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
}

function createDeferred(): Deferred {
  let resolve = () => {};
  const promise = new Promise<void>((resolvePromise) => {
    resolve = () => resolvePromise();
  });
  return { promise, resolve: () => resolve() };
}

function makeSession(id: string, parentID?: string): Session {
  return {
    id,
    projectID: "proj-1",
    directory: "/workspace",
    title: `Session ${id}`,
    version: "1",
    parentID,
    time: { created: 1000, updated: 1000 },
  };
}

const rootSession = makeSession("sess-root");
const childSession = makeSession("sess-child", "sess-root");

function makeWorkspace(): Workspace {
  return {
    id: WS,
    userId: "user-1",
    name: "QA Workspace",
    path: "/tmp/ws-1",
    type: "repo",
    parentRepoPath: null,
    packageManager: null,
    quickCommands: null,
    backend: "local",
    provider: null,
    opencodeUrl: null,
    agentUrl: null,
    providerMeta: null,
    shellCommand: null,
    sshTarget: null,
    sshPath: null,
    worktreeSymlinks: null,
    linkedTaskId: null,
    linkedTaskMeta: null,
    color: null,
    createdAt: new Date(0),
    lastAccessedAt: new Date(0),
  };
}

function workspaceState(overrides: Partial<WorkspaceState>): WorkspaceState {
  return {
    sessions: {},
    sessionsLoaded: true,
    messages: {},
    optimisticMessageIds: {},
    sessionStatuses: {},
    permissions: [],
    questions: [],
    todos: {},
    todoUpdatedAt: {},
    sessionAgents: {},
    sessionModels: {},
    sessionVariants: {},
    lastViewedAt: {},
    pinnedSessionIds: new Set(),
    sessionNotes: {},
    ...overrides,
  };
}

function seedWorkspace(
  sessions: readonly Session[],
  sessionStatuses: Record<string, SessionStatus> = {},
): void {
  useChatStore.setState({
    workspaceStates: {
      [WS]: workspaceState({
        sessions: Object.fromEntries(
          sessions.map((session) => [session.id, session]),
        ),
        sessionStatuses,
      }),
    },
  });
}

function emit(type: string, properties: Record<string, unknown>): void {
  useChatStore.getState().handleEvent({ type, properties }, WS);
}

function storedStatus(sessionId: string): SessionStatus | undefined {
  return useChatStore.getState().workspaceStates[WS]?.sessionStatuses[
    sessionId
  ];
}

function notificationTags(): string[] {
  return vi
    .mocked(showBrowserNotification)
    .mock.calls.map(([content]) => content.tag);
}

function notificationTitles(): string[] {
  return vi
    .mocked(showBrowserNotification)
    .mock.calls.map(([content]) => content.title);
}

function soundCount(event: SoundEventType): number {
  return vi
    .mocked(playSoundForEvent)
    .mock.calls.filter(([playedEvent]) => playedEvent === event).length;
}

function unseenKeys(): readonly string[] {
  return useAttentionStore.getState().unseenFinishedKeys;
}

function statusRequestUrls(): string[] {
  return fetchMock.mock.calls
    .map(([input]) => toUrl(input))
    .filter((url) => url.pathname.endsWith("/session/status"))
    .map((url) => url.href);
}

function wasSessionLookedUp(sessionId: string): boolean {
  return fetchMock.mock.calls.some(
    ([input]) => toUrl(input).pathname === `/api/opencode/session/${sessionId}`,
  );
}

function childPermission(): PermissionRequest {
  return {
    id: "perm-1",
    sessionID: "sess-child",
    permission: "bash",
    patterns: ["git push"],
    metadata: {},
    always: [],
  };
}

function childQuestion(): Record<string, unknown> {
  return {
    id: "que-1",
    sessionID: "sess-child",
    questions: [
      {
        question: "Continue?",
        header: "Confirm",
        options: [],
        multiple: false,
        custom: false,
      },
    ],
  };
}

async function flushLineageSettleAndVerification(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(2500);
  await vi.advanceTimersByTimeAsync(0);
}

beforeEach(() => {
  vi.clearAllMocks();
  statusMap = {};
  omoStatusMap = {};
  omoStatusFails = false;
  remoteSessions = {};
  statusResponseGate = null;
  isSessionLookupRejected = false;
  _resetModuleCaches();
  useChatStore.setState({
    workspaceStates: {},
    activeWorkspaceId: null,
    activeSessionId: null,
    streamingError: null,
    streamingPollInterval: null,
    optimisticStreamingSessionId: null,
    globalEventSource: null,
    sseWorkspaceIds: [WS],
    engineRev: 0,
  });
  useAttentionStore.setState({ unseenFinishedKeys: [] });
  useWorkspaceStore.setState({ workspaces: [makeWorkspace()] });
  resetTurnCompletionTracker();
  vi.useFakeTimers();
  vi.spyOn(document, "hasFocus").mockReturnValue(false);
  window.history.replaceState({}, "", "/");
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  useChatStore.getState().disconnectGlobalSSE();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("finished notifications", () => {
  it("case 1: announces an idle root without children once, labelled, with the agent sound and an unseen key", () => {
    // Given
    seedWorkspace([rootSession], { "sess-root": BUSY });

    // When
    emit("session.idle", { sessionID: "sess-root" });

    // Then
    expect(showBrowserNotification).toHaveBeenCalledTimes(1);
    expect(showBrowserNotification).toHaveBeenCalledWith({
      title: "Session sess-root finished",
      body: "QA Workspace · Ready for your next message",
      tag: ROOT_FINISHED_TAG,
      targetHref: createWorkbenchHref({
        open: "chat",
        workspaceId: "ws-1",
        sessionId: "sess-root",
      }),
    });
    expect(vi.mocked(playSoundForEvent).mock.calls).toEqual([["agent"]]);
    expect(unseenKeys()).toEqual(["ws-1:sess-root"]);
  });

  function settleChildWhileRootBusy(): void {
    seedWorkspace([rootSession, childSession]);
    emit("session.status", { sessionID: "sess-root", status: BUSY });
    emit("session.status", { sessionID: "sess-child", status: BUSY });
    emit("session.status", { sessionID: "sess-child", status: IDLE });
    emit("session.idle", { sessionID: "sess-child" });
    vi.advanceTimersByTime(2500);
  }

  it("case 2: stays quiet when a child settles while its root is busy", () => {
    // When
    settleChildWhileRootBusy();

    // Then
    expect(showBrowserNotification).not.toHaveBeenCalled();
    expect(soundCount("agent")).toBe(0);
  });

  it("case 2: announces exactly once when the busy root goes idle after its child settled", () => {
    // Given
    settleChildWhileRootBusy();

    // When
    emit("session.idle", { sessionID: "sess-root" });

    // Then
    expect(notificationTags()).toEqual([ROOT_FINISHED_TAG]);
    expect(soundCount("agent")).toBe(1);
  });

  async function idleRootWhileServerReportsBusyChild(): Promise<void> {
    seedWorkspace([rootSession, childSession], {
      "sess-root": BUSY,
      "sess-child": BUSY,
    });
    statusMap = { "sess-child": BUSY };
    emit("session.idle", { sessionID: "sess-root" });
    await vi.advanceTimersByTimeAsync(0);
  }

  it("case 3: stays quiet when the server confirms the child is still busy", async () => {
    // When
    await idleRootWhileServerReportsBusyChild();

    // Then
    expect(statusRequestUrls()).toHaveLength(1);
    expect(showBrowserNotification).not.toHaveBeenCalled();
  });

  it("case 3: announces the root once after the busy child reports idle by status only", async () => {
    // Given
    await idleRootWhileServerReportsBusyChild();

    // When
    emit("session.status", { sessionID: "sess-child", status: IDLE });
    await vi.advanceTimersByTimeAsync(2500);

    // Then
    expect(notificationTags()).toEqual([ROOT_FINISHED_TAG]);
  });

  it("case 4: flips a stale busy child via the server and announces the root once", async () => {
    // Given
    seedWorkspace([rootSession, childSession], {
      "sess-root": BUSY,
      "sess-child": BUSY,
    });

    // When
    emit("session.idle", { sessionID: "sess-root" });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(2500);

    // Then
    expect(storedStatus("sess-child")).toEqual(IDLE);
    expect(notificationTags()).toEqual([ROOT_FINISHED_TAG]);
  });

  it("case 5: announces a root once when its session.idle is delivered twice", () => {
    // Given
    seedWorkspace([rootSession], { "sess-root": BUSY });

    // When
    emit("session.idle", { sessionID: "sess-root" });
    emit("session.idle", { sessionID: "sess-root" });

    // Then
    expect(notificationTags()).toEqual([ROOT_FINISHED_TAG]);
  });

  it("case 6: announces again when the root went busy between two finished turns", () => {
    // Given
    seedWorkspace([rootSession], { "sess-root": BUSY });

    // When
    emit("session.idle", { sessionID: "sess-root" });
    emit("session.status", { sessionID: "sess-root", status: BUSY });
    vi.advanceTimersByTime(1000);
    emit("session.idle", { sessionID: "sess-root" });

    // Then
    expect(notificationTags()).toEqual([ROOT_FINISHED_TAG, ROOT_FINISHED_TAG]);
  });

  it("case 10: keeps an on-screen root seen but still plays the sound and notifies", () => {
    // Given
    seedWorkspace([rootSession], { "sess-root": BUSY });
    useChatStore.setState({
      activeWorkspaceId: WS,
      activeSessionId: "sess-root",
    });
    vi.mocked(document.hasFocus).mockReturnValue(true);
    window.history.replaceState({}, "", "/chat");

    // When
    emit("session.idle", { sessionID: "sess-root" });

    // Then
    expect(unseenKeys()).toEqual([]);
    expect(soundCount("agent")).toBe(1);
    expect(showBrowserNotification).toHaveBeenCalledTimes(1);
  });

  it("case 12: still refreshes git status when a child goes idle", () => {
    // Given
    seedWorkspace([rootSession, childSession], {
      "sess-root": BUSY,
      "sess-child": BUSY,
    });

    // When
    emit("session.idle", { sessionID: "sess-child" });

    // Then
    expect(requestGitStatusRefresh).toHaveBeenCalledWith(WS);
  });

  it("case 15: labels an unknown worker's settle with its fetched root and keeps fetched sessions out of the store", async () => {
    // Given
    seedWorkspace([rootSession], { "sess-root": IDLE });
    remoteSessions = {
      "sess-worker": {
        ...makeSession("sess-worker", "sess-bg-root"),
        title: "Worker",
      },
      "sess-bg-root": {
        ...makeSession("sess-bg-root"),
        title: "Background Root",
      },
    };

    // When
    emit("session.idle", { sessionID: "sess-worker" });
    await flushLineageSettleAndVerification();

    // Then
    expect(notificationTitles()).toEqual(["Background Root finished"]);
    expect(unseenKeys()).toEqual(["ws-1:sess-bg-root"]);
    const storedSessions =
      useChatStore.getState().workspaceStates[WS]?.sessions ?? {};
    expect(storedSessions).not.toHaveProperty("sess-worker");
    expect(storedSessions).not.toHaveProperty("sess-bg-root");
  });

  it("case 16: stays quiet when an unknown session's lineage lookup fails", async () => {
    // Given
    seedWorkspace([rootSession], { "sess-root": IDLE });

    // When
    emit("session.idle", { sessionID: "sess-unknown" });
    await flushLineageSettleAndVerification();

    // Then
    expect(wasSessionLookedUp("sess-unknown")).toBe(true);
    expect(showBrowserNotification).not.toHaveBeenCalled();
    expect(unseenKeys()).toEqual([]);
  });

  it("stays quiet without an unhandled rejection when the lineage lookup rejects", async () => {
    // Given
    seedWorkspace([rootSession], { "sess-root": IDLE });
    isSessionLookupRejected = true;

    // When
    emit("session.idle", { sessionID: "sess-unknown" });
    await flushLineageSettleAndVerification();

    // Then
    expect(wasSessionLookedUp("sess-unknown")).toBe(true);
    expect(showBrowserNotification).not.toHaveBeenCalled();
  });

  it("stays quiet when the lineage lookup answers with something that is not a session", async () => {
    // Given
    seedWorkspace([rootSession], { "sess-root": IDLE });
    remoteSessions = { "sess-unknown": { error: "Session not found" } };

    // When
    emit("session.idle", { sessionID: "sess-unknown" });
    await flushLineageSettleAndVerification();

    // Then
    expect(wasSessionLookedUp("sess-unknown")).toBe(true);
    expect(showBrowserNotification).not.toHaveBeenCalled();
  });

  it("case 17: stays quiet when an omo root reports idle by status only", async () => {
    // Given
    seedWorkspace([makeSession("omo_root")]);

    // When
    emit("session.status", { sessionID: "omo_root", status: BUSY });
    emit("session.status", { sessionID: "omo_root", status: IDLE });
    await vi.advanceTimersByTimeAsync(2500);

    // Then
    expect(showBrowserNotification).not.toHaveBeenCalled();
  });

  it("settles a child whose busy and idle statuses arrive within one frame", async () => {
    // Given
    seedWorkspace([rootSession, childSession], { "sess-root": IDLE });

    // When
    emit("session.status", { sessionID: "sess-child", status: BUSY });
    emit("session.status", { sessionID: "sess-child", status: IDLE });
    await vi.advanceTimersByTimeAsync(2500);

    // Then
    expect(notificationTags()).toEqual([ROOT_FINISHED_TAG]);
  });

  function seedReloadedTree(): void {
    seedWorkspace(
      [
        rootSession,
        makeSession("sess-c1", "sess-root"),
        makeSession("sess-c2", "sess-root"),
      ],
      { "sess-c1": BUSY },
    );
  }

  it("case 22: stays quiet and adopts the busy root after a reload when the server reports work", async () => {
    // Given
    seedReloadedTree();
    statusMap = { "sess-root": BUSY, "sess-c2": BUSY };

    // When
    emit("session.idle", { sessionID: "sess-c1" });
    await vi.advanceTimersByTimeAsync(2500);
    await vi.advanceTimersByTimeAsync(0);

    // Then
    expect(showBrowserNotification).not.toHaveBeenCalled();
    expect(storedStatus("sess-root")).toEqual(BUSY);
  });

  it("case 22: announces once after a reload when the server reports nothing active", async () => {
    // Given
    seedReloadedTree();

    // When
    emit("session.idle", { sessionID: "sess-c1" });
    await vi.advanceTimersByTimeAsync(2500);
    await vi.advanceTimersByTimeAsync(0);

    // Then
    expect(notificationTags()).toEqual([ROOT_FINISHED_TAG]);
  });
});

describe("approval and question notifications", () => {
  it("case 7: notifies a subagent's approval request once, labelled with its root, with the permission sound", () => {
    // Given
    seedWorkspace([rootSession, childSession]);

    // When
    emit("permission.asked", { ...childPermission() });

    // Then
    expect(showBrowserNotification).toHaveBeenCalledTimes(1);
    expect(showBrowserNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Approval needed: Session sess-root",
        body: expect.stringContaining(
          'Subagent "Session sess-child" wants bash: git push',
        ),
      }),
    );
    expect(vi.mocked(playSoundForEvent).mock.calls).toEqual([["permissions"]]);
  });

  it("case 7: notifies and plays a replayed approval request only once", () => {
    // Given
    seedWorkspace([rootSession, childSession]);

    // When
    emit("permission.asked", { ...childPermission() });
    emit("permission.asked", { ...childPermission() });

    // Then
    expect(showBrowserNotification).toHaveBeenCalledTimes(1);
    expect(soundCount("permissions")).toBe(1);
  });

  it("notifies an approval request even when its session's lineage cannot be resolved", async () => {
    // Given
    seedWorkspace([rootSession]);

    // When
    emit("permission.asked", {
      ...childPermission(),
      sessionID: "sess-ghost",
    });
    await vi.advanceTimersByTimeAsync(0);

    // Then
    expect(notificationTitles()).toEqual(["Approval needed: Untitled session"]);
  });

  it("case 8: notifies a question once, labelled with its root, without a sound", () => {
    // Given
    seedWorkspace([rootSession, childSession]);

    // When
    emit("question.asked", childQuestion());

    // Then
    expect(notificationTitles()).toEqual(["Question from Session sess-root"]);
    expect(playSoundForEvent).not.toHaveBeenCalled();
  });

  it("notifies a replayed question only once", () => {
    // Given
    seedWorkspace([rootSession, childSession]);

    // When
    emit("question.asked", childQuestion());
    emit("question.asked", childQuestion());

    // Then
    expect(showBrowserNotification).toHaveBeenCalledTimes(1);
  });
});

describe("error notifications", () => {
  function errorProperties(name: string): Record<string, unknown> {
    return { name, data: { message: "Something broke" } };
  }

  it("case 9: stays silent for an error in a known child session", () => {
    // Given
    seedWorkspace([rootSession, childSession]);

    // When
    emit("session.error", {
      sessionID: "sess-child",
      error: errorProperties("UnknownError"),
    });

    // Then
    expect(soundCount("errors")).toBe(0);
    expect(showBrowserNotification).not.toHaveBeenCalled();
  });

  it("case 9: stays silent when the user aborted the root", () => {
    // Given
    seedWorkspace([rootSession]);

    // When
    emit("session.error", {
      sessionID: "sess-root",
      error: errorProperties("MessageAbortedError"),
    });

    // Then
    expect(soundCount("errors")).toBe(0);
    expect(showBrowserNotification).not.toHaveBeenCalled();
  });

  it("case 9: plays the error sound and notifies once for a root error", () => {
    // Given
    seedWorkspace([rootSession]);

    // When
    emit("session.error", {
      sessionID: "sess-root",
      error: errorProperties("UnknownError"),
    });

    // Then
    expect(soundCount("errors")).toBe(1);
    expect(notificationTitles()).toEqual(["Error in Session sess-root"]);
  });

  it("case 9: names the workspace for an error without a session", () => {
    // Given
    seedWorkspace([rootSession]);

    // When
    emit("session.error", { error: errorProperties("UnknownError") });

    // Then
    expect(notificationTitles()).toEqual(["Error in QA Workspace"]);
  });

  it("notifies an error from a session whose lineage cannot be resolved", async () => {
    // Given
    seedWorkspace([rootSession]);

    // When
    emit("session.error", {
      sessionID: "sess-ghost",
      error: errorProperties("UnknownError"),
    });
    await vi.advanceTimersByTimeAsync(0);

    // Then
    expect(notificationTitles()).toEqual(["Error in Untitled session"]);
  });
});

describe("unseen clearing", () => {
  it("case 11: clears a removed session's unseen key without any SSE event", () => {
    // Given
    seedWorkspace([rootSession]);
    useAttentionStore.getState().markFinishedUnseen(WS, "sess-root");

    // When
    useChatStore.getState().removeSessionLocal("sess-root", WS);

    // Then
    expect(unseenKeys()).toEqual([]);
  });

  it("case 11: clears every unseen key of a reset workspace", () => {
    // Given
    seedWorkspace([rootSession, childSession]);
    const attention = useAttentionStore.getState();
    attention.markFinishedUnseen(WS, "sess-root");
    attention.markFinishedUnseen(WS, "sess-other");
    attention.markFinishedUnseen("ws-2", "sess-elsewhere");

    // When
    useChatStore.getState().resetWorkspace(WS);

    // Then
    expect(unseenKeys()).toEqual(["ws-2:sess-elsewhere"]);
  });
});

describe("reconcileWorkspaceStatuses", () => {
  it("case 13: keeps statuses SSE delivered during the fetch", async () => {
    // Given
    seedWorkspace([rootSession, childSession, makeSession("sess-other")], {
      "sess-root": IDLE,
      "sess-child": BUSY,
      "sess-other": IDLE,
    });
    const gate = createDeferred();
    statusResponseGate = gate.promise;
    const reconcile = useChatStore.getState().reconcileWorkspaceStatuses(WS);
    const sseChildIdle: SessionStatus = { type: "idle" };
    const sseOtherBusy: SessionStatus = { type: "busy" };

    // When
    emit("session.status", { sessionID: "sess-child", status: sseChildIdle });
    emit("session.status", { sessionID: "sess-other", status: sseOtherBusy });
    // SSE statuses land in the store on the next animation frame.
    vi.advanceTimersToNextFrame();
    gate.resolve();
    await reconcile;

    // Then
    expect(storedStatus("sess-child")).toBe(sseChildIdle);
    expect(storedStatus("sess-other")).toBe(sseOtherBusy);
  });

  it("case 13b: treats an explicit omo idle entry as not active and announces the omo root once", async () => {
    // Given
    seedWorkspace([makeSession("omo_root")], { omo_root: BUSY });
    omoStatusMap = { omo_root: IDLE };

    // When
    await useChatStore.getState().reconcileWorkspaceStatuses(WS);
    await vi.advanceTimersByTimeAsync(2500);

    // Then
    expect(storedStatus("omo_root")).toEqual(IDLE);
    expect(notificationTags()).toEqual(["devhub-finished-omo_root"]);
  });

  it("case 14: returns false without creating a bucket for an unknown workspace", async () => {
    // When
    const isApplied = await useChatStore
      .getState()
      .reconcileWorkspaceStatuses("ws-missing");

    // Then
    expect(isApplied).toBe(false);
    expect(useChatStore.getState().workspaceStates).not.toHaveProperty(
      "ws-missing",
    );
  });

  it("case 14: returns false and changes nothing when the engine switches during the fetch", async () => {
    // Given
    const seededBusy: SessionStatus = { type: "busy" };
    seedWorkspace([rootSession], { "sess-root": seededBusy });
    const gate = createDeferred();
    statusResponseGate = gate.promise;
    const reconcile = useChatStore.getState().reconcileWorkspaceStatuses(WS);

    // When
    useChatStore.setState({ engineRev: 1 });
    gate.resolve();

    // Then
    expect(await reconcile).toBe(false);
    expect(storedStatus("sess-root")).toBe(seededBusy);
  });

  it("case 14: asks only the OpenCode engine when the workspace has no omo sessions", async () => {
    // Given
    seedWorkspace([rootSession], { "sess-root": BUSY });

    // When
    await useChatStore.getState().reconcileWorkspaceStatuses(WS);

    // Then
    const requestUrls = statusRequestUrls();
    expect(requestUrls).toHaveLength(1);
    expect(requestUrls[0]).toContain("engine=opencode");
    expect(requestUrls.some((url) => url.includes("engine=omo"))).toBe(false);
  });

  it("case 19: leaves the sessions of an engine that did not answer untouched", async () => {
    // Given
    const seededOmoBusy: SessionStatus = { type: "busy" };
    seedWorkspace([makeSession("omo_root"), rootSession], {
      omo_root: seededOmoBusy,
      "sess-root": BUSY,
    });
    omoStatusFails = true;

    // When
    await useChatStore.getState().reconcileWorkspaceStatuses(WS);
    await vi.advanceTimersByTimeAsync(2500);

    // Then
    expect(storedStatus("sess-root")).toEqual(IDLE);
    expect(storedStatus("omo_root")).toBe(seededOmoBusy);
    expect(notificationTags()).not.toContain("devhub-finished-omo_root");
  });

  it("case 21: reconciles statuses when the server's upstream stream reconnects", async () => {
    // Given
    seedWorkspace([rootSession, childSession], {
      "sess-root": IDLE,
      "sess-child": BUSY,
    });

    // When
    emit("workspace.connection", { state: "connected", attempt: 1 });
    await vi.advanceTimersByTimeAsync(0);

    // Then
    expect(statusRequestUrls()).toHaveLength(1);
    expect(storedStatus("sess-child")).toEqual(IDLE);
  });

  it("case 21: skips the status reconcile on the first upstream connection", async () => {
    // Given
    seedWorkspace([rootSession, childSession], {
      "sess-root": IDLE,
      "sess-child": BUSY,
    });

    // When
    emit("workspace.connection", { state: "connected", attempt: 0 });
    await vi.advanceTimersByTimeAsync(0);

    // Then
    expect(statusRequestUrls()).toEqual([]);
  });

  it("reconciles the statuses of every connected workspace when the event stream opens", async () => {
    // Given
    seedWorkspace([rootSession, childSession], {
      "sess-root": IDLE,
      "sess-child": BUSY,
    });
    useChatStore.getState().connectGlobalSSE([WS], { force: true });
    const source = useChatStore.getState().globalEventSource;
    if (!source) throw new Error("Expected an event source");

    // When
    source.onopen?.call(source, new Event("open"));
    await vi.advanceTimersByTimeAsync(0);

    // Then
    expect(statusRequestUrls()).toEqual([
      expect.stringContaining("engine=opencode"),
    ]);
    expect(storedStatus("sess-child")).toEqual(IDLE);
  });

  it("case 23: never re-adds a busy status for a session deleted during the fetch", async () => {
    // Given
    seedWorkspace([rootSession, makeSession("sess-gone")], {
      "sess-root": BUSY,
    });
    statusMap = { "sess-root": BUSY, "sess-gone": BUSY };
    const gate = createDeferred();
    statusResponseGate = gate.promise;
    const reconcile = useChatStore.getState().reconcileWorkspaceStatuses(WS);

    // When
    useChatStore.getState().removeSessionLocal("sess-gone", WS);
    gate.resolve();
    await reconcile;

    // Then
    expect(storedStatus("sess-gone")).toBeUndefined();
  });
});

describe("refreshActiveSessionStatus", () => {
  it("case 18: announces the active root when the refresh finds it idle, asking only its engine", async () => {
    // Given
    seedWorkspace([rootSession], { "sess-root": BUSY });
    useChatStore.setState({
      activeWorkspaceId: WS,
      activeSessionId: "sess-root",
    });

    // When
    await useChatStore.getState().refreshActiveSessionStatus(WS);

    // Then
    expect(notificationTags()).toEqual([ROOT_FINISHED_TAG]);
    expect(statusRequestUrls()).toEqual([
      expect.stringContaining("engine=opencode"),
    ]);
  });

  it("announces nothing when the refresh confirms an already idle active root", async () => {
    // Given
    seedWorkspace([rootSession], { "sess-root": IDLE });
    useChatStore.setState({
      activeWorkspaceId: WS,
      activeSessionId: "sess-root",
    });

    // When
    await useChatStore.getState().refreshActiveSessionStatus(WS);

    // Then
    expect(statusRequestUrls()).toHaveLength(1);
    expect(showBrowserNotification).not.toHaveBeenCalled();
  });

  it("case 20: never writes idle over a status SSE changed during the fetch", async () => {
    // Given
    // The SSE buffer skips a status equal to the stored one, so the root
    // starts in retry and the delivered busy is a real change.
    seedWorkspace([rootSession], {
      "sess-root": {
        type: "retry",
        attempt: 1,
        message: "Rate limited",
        next: 0,
      },
    });
    useChatStore.setState({
      activeWorkspaceId: WS,
      activeSessionId: "sess-root",
    });
    const gate = createDeferred();
    statusResponseGate = gate.promise;
    const refresh = useChatStore.getState().refreshActiveSessionStatus(WS);
    const sseBusy: SessionStatus = { type: "busy" };

    // When
    emit("session.status", { sessionID: "sess-root", status: sseBusy });
    vi.advanceTimersToNextFrame();
    gate.resolve();
    await refresh;

    // Then
    expect(statusRequestUrls()).toEqual([
      expect.stringContaining("engine=opencode"),
    ]);
    expect(storedStatus("sess-root")).toBe(sseBusy);
    expect(showBrowserNotification).not.toHaveBeenCalled();
  });
});
