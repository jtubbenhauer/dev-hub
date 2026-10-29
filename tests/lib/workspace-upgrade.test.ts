import { describe, it, expect } from "vitest";
import {
  getProviderUpgradeCommand,
  lastOutputLines,
} from "@/lib/workspaces/upgrade";
import type { Workspace, WorkspaceProvider } from "@/types";

const rigProvider: WorkspaceProvider = {
  id: "provider-rig",
  name: "rig-cli",
  binaryPath: "rig-cli",
  commands: {
    create: "{binary} create",
    destroy: "{binary} destroy",
    status: "{binary} status",
    upgrade: "{binary} upgrade {id}",
  },
};

const flyProvider: WorkspaceProvider = {
  id: "provider-fly",
  name: "fly.io",
  binaryPath: "rig-cli",
  commands: {
    create: "{binary} create",
    destroy: "{binary} destroy",
    status: "{binary} status",
  },
};

function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: "ws-1",
    userId: "user-1",
    name: "fix-invoices",
    path: "/home/dev/code",
    type: "repo",
    parentRepoPath: null,
    packageManager: null,
    quickCommands: null,
    backend: "remote",
    provider: "rig-cli",
    opencodeUrl: null,
    agentUrl: null,
    providerMeta: { providerId: "provider-rig" },
    shellCommand: null,
    sshTarget: null,
    sshPath: null,
    worktreeSymlinks: null,
    linkedTaskId: null,
    linkedTaskMeta: null,
    color: null,
    createdAt: new Date(),
    lastAccessedAt: new Date(),
    ...overrides,
  };
}

describe("getProviderUpgradeCommand", () => {
  it("returns the upgrade command of the workspace's provider", () => {
    expect(
      getProviderUpgradeCommand(makeWorkspace(), [flyProvider, rigProvider]),
    ).toBe("{binary} upgrade {id}");
  });

  it.each([
    [
      "the provider has no upgrade command",
      makeWorkspace({ providerMeta: { providerId: "provider-fly" } }),
    ],
    [
      "the provider is not configured",
      makeWorkspace({ providerMeta: { providerId: "provider-missing" } }),
    ],
    ["the workspace has no provider", makeWorkspace({ providerMeta: null })],
    ["the workspace is local", makeWorkspace({ backend: "local" })],
  ])("returns nothing when %s", (_description, workspace) => {
    expect(
      getProviderUpgradeCommand(workspace, [flyProvider, rigProvider]),
    ).toBeUndefined();
  });

  it("treats a blank upgrade command as none", () => {
    const blankProvider: WorkspaceProvider = {
      ...rigProvider,
      commands: { ...rigProvider.commands, upgrade: "  " },
    };
    expect(
      getProviderUpgradeCommand(makeWorkspace(), [blankProvider]),
    ).toBeUndefined();
  });
});

describe("lastOutputLines", () => {
  it("keeps the last lines of trimmed output", () => {
    expect(
      lastOutputLines("one\ntwo\nUpgrade complete: 1 upgraded, 0 failed.\n", 1),
    ).toBe("Upgrade complete: 1 upgraded, 0 failed.");
    expect(lastOutputLines("one\ntwo\nthree", 2)).toBe("two\nthree");
  });
});
