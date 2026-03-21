import { describe, it, expect } from "vitest";
import {
  getWorkspaceBehaviour,
  shouldSSEConnect,
} from "@/lib/workspaces/behaviour";
import { Workspace, DEFAULT_PROVIDER_BEHAVIOUR } from "@/types";

const makeWorkspace = (overrides: Partial<Workspace> = {}): Workspace => ({
  id: "ws-1",
  userId: "user-1",
  name: "Test",
  path: "/test",
  type: "repo",
  parentRepoPath: null,
  packageManager: null,
  quickCommands: null,
  backend: "remote",
  provider: null,
  opencodeUrl: null,
  agentUrl: null,
  providerMeta: null,
  shellCommand: null,
  worktreeSymlinks: null,
  linkedTaskId: null,
  linkedTaskMeta: null,
  color: null,
  createdAt: new Date(),
  lastAccessedAt: new Date(),
  ...overrides,
});

describe("getWorkspaceBehaviour", () => {
  it("returns DEFAULT_PROVIDER_BEHAVIOUR when providerMeta is null", () => {
    const ws = makeWorkspace({ providerMeta: null });
    expect(getWorkspaceBehaviour(ws)).toEqual(DEFAULT_PROVIDER_BEHAVIOUR);
  });

  it("returns DEFAULT_PROVIDER_BEHAVIOUR when providerMeta has no behaviour key", () => {
    const ws = makeWorkspace({ providerMeta: { someOtherKey: "value" } });
    expect(getWorkspaceBehaviour(ws)).toEqual(DEFAULT_PROVIDER_BEHAVIOUR);
  });

  it("merges partial behaviour with defaults — partial fields override, rest are defaults", () => {
    const ws = makeWorkspace({
      providerMeta: {
        behaviour: {
          sseWhenInactive: false,
          supportsAutoSuspend: true,
        },
      },
    });
    const result = getWorkspaceBehaviour(ws);
    expect(result.sseWhenInactive).toBe(false);
    expect(result.supportsAutoSuspend).toBe(true);
    expect(result.inactiveHealthIntervalMs).toBe(
      DEFAULT_PROVIDER_BEHAVIOUR.inactiveHealthIntervalMs,
    );
    expect(result.activeHealthIntervalMs).toBe(
      DEFAULT_PROVIDER_BEHAVIOUR.activeHealthIntervalMs,
    );
    expect(result.gitStatusIntervalMs).toBe(
      DEFAULT_PROVIDER_BEHAVIOUR.gitStatusIntervalMs,
    );
    expect(result.branchPollWhenInactive).toBe(
      DEFAULT_PROVIDER_BEHAVIOUR.branchPollWhenInactive,
    );
    expect(result.resumeTimeSeconds).toBe(
      DEFAULT_PROVIDER_BEHAVIOUR.resumeTimeSeconds,
    );
  });

  it("returns exact Fly values when full Fly config is provided", () => {
    const flyBehaviour = {
      inactiveHealthIntervalMs: 60_000,
      activeHealthIntervalMs: 15_000,
      gitStatusIntervalMs: 20_000,
      sseWhenInactive: false,
      branchPollWhenInactive: false,
      supportsAutoSuspend: true,
      resumeTimeSeconds: 5,
    };
    const ws = makeWorkspace({ providerMeta: { behaviour: flyBehaviour } });
    expect(getWorkspaceBehaviour(ws)).toEqual(flyBehaviour);
  });
});

describe("shouldSSEConnect", () => {
  it("returns true for local workspace regardless of behaviour", () => {
    const ws = makeWorkspace({
      backend: "local",
      providerMeta: { behaviour: { sseWhenInactive: false } },
    });
    expect(shouldSSEConnect(ws, null)).toBe(true);
  });

  it("returns true for active remote workspace regardless of behaviour", () => {
    const ws = makeWorkspace({
      id: "ws-active",
      backend: "remote",
      providerMeta: { behaviour: { sseWhenInactive: false } },
    });
    expect(shouldSSEConnect(ws, "ws-active")).toBe(true);
  });

  it("returns true for inactive remote Docker workspace (default sseWhenInactive=true)", () => {
    const ws = makeWorkspace({
      id: "ws-docker",
      backend: "remote",
      providerMeta: null,
    });
    expect(shouldSSEConnect(ws, "ws-other")).toBe(true);
  });

  it("returns false for inactive remote Fly workspace (sseWhenInactive=false)", () => {
    const ws = makeWorkspace({
      id: "ws-fly",
      backend: "remote",
      providerMeta: { behaviour: { sseWhenInactive: false } },
    });
    expect(shouldSSEConnect(ws, "ws-other")).toBe(false);
  });

  it("returns true for inactive remote workspace when activeWorkspaceId is null and sseWhenInactive=true", () => {
    const ws = makeWorkspace({
      id: "ws-1",
      backend: "remote",
      providerMeta: null,
    });
    expect(shouldSSEConnect(ws, null)).toBe(true);
  });

  it("returns false for inactive remote workspace when activeWorkspaceId is null and sseWhenInactive=false", () => {
    const ws = makeWorkspace({
      id: "ws-1",
      backend: "remote",
      providerMeta: { behaviour: { sseWhenInactive: false } },
    });
    expect(shouldSSEConnect(ws, null)).toBe(false);
  });
});
