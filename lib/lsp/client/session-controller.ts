import type {
  connectLspSession,
  LspSessionHandle,
} from "@/lib/lsp/client/lsp-session";
import {
  LSP_CLOSE_CODES,
  type LspClientStatus,
  type LspStatusResponse,
} from "@/lib/lsp/types";
import { useLspStore } from "@/stores/lsp-store";

export const LSP_RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 16000] as const;
export const LSP_POLL_INTERVAL_MS = 1000;
export const LSP_POLL_MAX_ATTEMPTS = 30;
export const LSP_STABLE_CONNECTION_MS = 30_000;

type TimerHandle = ReturnType<typeof setTimeout>;

export interface LspSessionWorkspace {
  readonly id: string;
  readonly path: string;
  readonly backend: "local" | "remote";
}

export interface LspSessionInputs {
  readonly isLspEnabled: boolean;
  readonly workspace: LspSessionWorkspace | null;
  readonly isMonacoRegistered: boolean;
  readonly retryNonce: number;
}

export interface LspSessionControllerDeps {
  readonly fetchImpl: typeof fetch;
  readonly connect: typeof connectLspSession;
  readonly restoreBuiltin: () => void;
  readonly setTimeoutImpl?: typeof setTimeout;
  readonly clearTimeoutImpl?: typeof clearTimeout;
}

export interface LspSessionController {
  update(inputs: LspSessionInputs): void;
  dispose(): void;
}

type ServerPollResult =
  | { readonly kind: "running"; readonly wsUrl: string; readonly epoch: number }
  | { readonly kind: "failed"; readonly message: string }
  | { readonly kind: "superseded" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLspStatusResponse(value: unknown): value is LspStatusResponse {
  return (
    isRecord(value) &&
    typeof value.workspaceId === "string" &&
    typeof value.state === "string" &&
    (value.serverEpoch === null || typeof value.serverEpoch === "number") &&
    (value.wsUrl === null || typeof value.wsUrl === "string") &&
    (value.error === null || typeof value.error === "string")
  );
}

async function readJsonSafely(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function readErrorMessage(response: Response): Promise<string> {
  const body = await readJsonSafely(response);
  if (isRecord(body) && typeof body.error === "string") return body.error;
  return `LSP request failed with HTTP ${response.status}`;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const ignoreOutcome = () => undefined;

export function createLspSessionController(
  deps: LspSessionControllerDeps,
): LspSessionController {
  // Destructured so fetch/setTimeout are never invoked with `deps` as `this` (Illegal invocation).
  const { fetchImpl, connect, restoreBuiltin } = deps;
  const setTimer =
    deps.setTimeoutImpl ??
    ((callback: () => void, ms: number) => setTimeout(callback, ms));
  const clearTimer =
    deps.clearTimeoutImpl ?? ((timer: TimerHandle) => clearTimeout(timer));

  let attemptId = 0;
  let isDisposed = false;
  let handle: LspSessionHandle | null = null;
  let targetWorkspace: LspSessionWorkspace | null = null;
  let hasStartedServer = false;
  let failureCount = 0;
  let retryTimer: TimerHandle | null = null;
  let stableTimer: TimerHandle | null = null;
  let lastRetryNonce: number | null = null;
  let pendingStop: Promise<void> = Promise.resolve();
  // Settles once every POST start sent so far has settled and any superseded server it started is stopped.
  let startCleanup: Promise<void> = Promise.resolve();

  const setStatus = (status: LspClientStatus, message?: string | null) =>
    useLspStore.getState().setStatus(status, message);

  const wait = (ms: number) =>
    new Promise<void>((resolve) => {
      setTimer(resolve, ms);
    });

  function clearTimers(): void {
    if (retryTimer !== null) clearTimer(retryTimer);
    if (stableTimer !== null) clearTimer(stableTimer);
    retryTimer = null;
    stableTimer = null;
  }

  function disposeHandle(): void {
    handle?.dispose();
    handle = null;
  }

  function postControl(
    action: "start" | "stop",
    workspaceId: string,
  ): Promise<Response> {
    return fetchImpl("/api/lsp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, workspaceId }),
    });
  }

  function teardown(shouldRestore: boolean): void {
    attemptId += 1;
    clearTimers();
    disposeHandle();
    const stopRequest =
      targetWorkspace !== null && hasStartedServer
        ? postControl("stop", targetWorkspace.id).then(
            ignoreOutcome,
            ignoreOutcome,
          )
        : Promise.resolve();
    pendingStop = Promise.all([pendingStop, stopRequest, startCleanup]).then(
      ignoreOutcome,
    );
    targetWorkspace = null;
    hasStartedServer = false;
    failureCount = 0;
    useLspStore.getState().setSession(null, null);
    if (shouldRestore) restoreBuiltin();
  }

  function finishWithoutSession(
    status: "busy" | "error",
    message: string | null,
  ): void {
    clearTimers();
    disposeHandle();
    useLspStore.getState().setSession(null, null);
    setStatus(status, message);
    restoreBuiltin();
  }

  function handleConnectionFailure(workspace: LspSessionWorkspace): void {
    failureCount += 1;
    const delay = LSP_RETRY_DELAYS_MS[failureCount - 1];
    if (delay === undefined) {
      finishWithoutSession("error", "LSP connection failed repeatedly");
      return;
    }
    setStatus("connecting");
    const scheduledAttempt = attemptId;
    retryTimer = setTimer(() => {
      retryTimer = null;
      if (scheduledAttempt !== attemptId) return;
      void runConnectFlow(workspace);
    }, delay);
  }

  function handleUnexpectedClose(attempt: number, code: number): void {
    if (attempt !== attemptId || targetWorkspace === null) return;
    const workspace = targetWorkspace;
    // Invalidate the attempt so a still-pending connect() result is disposed as superseded.
    attemptId += 1;
    clearTimers();
    disposeHandle();
    if (code === LSP_CLOSE_CODES.BUSY) {
      hasStartedServer = false;
      finishWithoutSession("busy", null);
      return;
    }
    handleConnectionFailure(workspace);
  }

  async function stopSupersededStart(
    attempt: number,
    workspaceId: string,
    startResponse: Response,
  ): Promise<void> {
    if (attempt === attemptId || !startResponse.ok) return;
    // A newer attempt for the same workspace reuses this server; its own start is idempotent.
    if (targetWorkspace !== null && targetWorkspace.id === workspaceId) return;
    await postControl("stop", workspaceId);
  }

  async function pollUntilRunning(
    attempt: number,
    workspaceId: string,
  ): Promise<ServerPollResult> {
    const url = `/api/lsp?workspaceId=${encodeURIComponent(workspaceId)}`;
    for (let pollIndex = 0; pollIndex < LSP_POLL_MAX_ATTEMPTS; pollIndex++) {
      if (pollIndex > 0) {
        await wait(LSP_POLL_INTERVAL_MS);
        if (attempt !== attemptId) return { kind: "superseded" };
      }
      const response = await fetchImpl(url);
      if (attempt !== attemptId) return { kind: "superseded" };
      if (!response.ok) {
        const message = await readErrorMessage(response);
        if (attempt !== attemptId) return { kind: "superseded" };
        return { kind: "failed", message };
      }
      const body = await readJsonSafely(response);
      if (attempt !== attemptId) return { kind: "superseded" };
      if (!isLspStatusResponse(body)) continue;
      if (body.state === "error") {
        return { kind: "failed", message: body.error ?? "LSP server error" };
      }
      if (
        body.state === "running" &&
        body.wsUrl !== null &&
        body.serverEpoch !== null
      ) {
        return { kind: "running", wsUrl: body.wsUrl, epoch: body.serverEpoch };
      }
    }
    return { kind: "failed", message: "LSP server did not start" };
  }

  async function runConnectFlow(workspace: LspSessionWorkspace): Promise<void> {
    attemptId += 1;
    const attempt = attemptId;
    clearTimers();
    setStatus("starting");
    try {
      await pendingStop;
      if (attempt !== attemptId) return;
      const startRequest = postControl("start", workspace.id);
      const cleanupForThisStart = startRequest
        .then((response) =>
          stopSupersededStart(attempt, workspace.id, response),
        )
        .then(ignoreOutcome, ignoreOutcome);
      startCleanup = Promise.all([startCleanup, cleanupForThisStart]).then(
        ignoreOutcome,
      );
      const startResponse = await startRequest;
      if (attempt !== attemptId) return;
      if (startResponse.status === 409) {
        hasStartedServer = false;
        finishWithoutSession("busy", null);
        return;
      }
      if (!startResponse.ok) {
        const message = await readErrorMessage(startResponse);
        if (attempt !== attemptId) return;
        finishWithoutSession("error", message);
        return;
      }
      hasStartedServer = true;
      const pollResult = await pollUntilRunning(attempt, workspace.id);
      if (pollResult.kind === "superseded") return;
      if (pollResult.kind === "failed") {
        finishWithoutSession("error", pollResult.message);
        return;
      }
      setStatus("connecting");
      useLspStore.getState().setSession(workspace.id, pollResult.epoch);
      await connectSession(attempt, workspace, pollResult.wsUrl);
    } catch (error) {
      if (attempt !== attemptId) return;
      finishWithoutSession("error", describeError(error));
    }
  }

  async function connectSession(
    attempt: number,
    workspace: LspSessionWorkspace,
    wsUrl: string,
  ): Promise<void> {
    let connectedHandle: LspSessionHandle;
    try {
      connectedHandle = await connect({
        wsUrl,
        workspaceId: workspace.id,
        workspaceRoot: workspace.path,
        onUnexpectedClose: (code) => handleUnexpectedClose(attempt, code),
      });
    } catch {
      if (attempt !== attemptId) return;
      handleConnectionFailure(workspace);
      return;
    }
    if (attempt !== attemptId) {
      connectedHandle.dispose();
      return;
    }
    handle = connectedHandle;
    setStatus("connected");
    stableTimer = setTimer(() => {
      stableTimer = null;
      if (attempt === attemptId) failureCount = 0;
    }, LSP_STABLE_CONNECTION_MS);
  }

  function update(inputs: LspSessionInputs): void {
    if (isDisposed) return;
    const isRetryRequested =
      lastRetryNonce !== null && lastRetryNonce !== inputs.retryNonce;
    lastRetryNonce = inputs.retryNonce;
    const { workspace } = inputs;

    if (!inputs.isLspEnabled) {
      teardown(true);
      setStatus("disabled");
      return;
    }
    if (workspace === null || workspace.backend !== "local") {
      teardown(true);
      setStatus("unavailable");
      return;
    }
    if (!inputs.isMonacoRegistered) {
      teardown(false);
      setStatus("waiting-for-editor");
      return;
    }
    if (targetWorkspace !== null && targetWorkspace.id !== workspace.id) {
      teardown(false);
    }
    if (targetWorkspace !== null && !isRetryRequested) return;
    if (isRetryRequested) {
      clearTimers();
      disposeHandle();
    }
    targetWorkspace = workspace;
    failureCount = 0;
    void runConnectFlow(workspace);
  }

  function dispose(): void {
    if (isDisposed) return;
    isDisposed = true;
    attemptId += 1;
    clearTimers();
    disposeHandle();
    restoreBuiltin();
  }

  return { update, dispose };
}
