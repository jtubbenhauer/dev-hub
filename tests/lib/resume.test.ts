import { describe, it, expect } from "vitest";
import { canResume, interpolateProviderCommand } from "@/lib/workspaces/resume";
import {
  Workspace,
  WorkspaceProvider,
  DEFAULT_PROVIDER_BEHAVIOUR,
} from "@/types";

const mockProvider: WorkspaceProvider = {
  id: "provider-1",
  name: "Test Provider",
  binaryPath: "/usr/bin/test-cli",
  commands: {
    create: "test-cli create",
    destroy: "test-cli destroy",
    status: "test-cli status",
    start: "test-cli start",
  },
  behaviour: {
    ...DEFAULT_PROVIDER_BEHAVIOUR,
    supportsAutoSuspend: true,
  },
};

const mockWorkspace: Workspace = {
  id: "workspace-1",
  userId: "user-1",
  name: "test-workspace",
  path: "/home/user/workspace",
  type: "repo",
  parentRepoPath: null,
  packageManager: "npm",
  quickCommands: null,
  backend: "remote",
  provider: "provider-1",
  opencodeUrl: "http://localhost:7500",
  agentUrl: "http://localhost:7500",
  providerMeta: {
    providerId: "provider-1",
    providerWorkspaceId: "remote-workspace-123",
  },
  shellCommand: "test-cli exec",
  worktreeSymlinks: null,
  linkedTaskId: null,
  linkedTaskMeta: null,
  color: "#000000",
  createdAt: new Date(),
  lastAccessedAt: new Date(),
};

describe("canResume", () => {
  it("returns true when all conditions are met", () => {
    const result = canResume(mockWorkspace, [mockProvider]);
    expect(result).toBe(true);
  });

  it("returns false when workspace backend is not remote", () => {
    const localWorkspace = {
      ...mockWorkspace,
      backend: "local" as const,
    };
    const result = canResume(localWorkspace, [mockProvider]);
    expect(result).toBe(false);
  });

  it("returns false when workspace has no providerMeta", () => {
    const workspaceNoMeta = {
      ...mockWorkspace,
      providerMeta: null,
    };
    const result = canResume(workspaceNoMeta, [mockProvider]);
    expect(result).toBe(false);
  });

  it("returns false when providerMeta has no providerId", () => {
    const workspaceNoPId = {
      ...mockWorkspace,
      providerMeta: { providerWorkspaceId: "remote-123" },
    };
    const result = canResume(workspaceNoPId, [mockProvider]);
    expect(result).toBe(false);
  });

  it("returns false when provider is not found", () => {
    const workspaceWrongProvider = {
      ...mockWorkspace,
      providerMeta: {
        providerId: "non-existent-provider",
        providerWorkspaceId: "remote-123",
      },
    };
    const result = canResume(workspaceWrongProvider, [mockProvider]);
    expect(result).toBe(false);
  });

  it("returns false when provider does not support auto-suspend", () => {
    const providerNoAutoSuspend: WorkspaceProvider = {
      ...mockProvider,
      behaviour: {
        ...DEFAULT_PROVIDER_BEHAVIOUR,
        supportsAutoSuspend: false,
      },
    };
    const result = canResume(mockWorkspace, [providerNoAutoSuspend]);
    expect(result).toBe(false);
  });

  it("returns false when provider has no behaviour", () => {
    const providerNoBehaviour: WorkspaceProvider = {
      ...mockProvider,
      behaviour: undefined,
    };
    const result = canResume(mockWorkspace, [providerNoBehaviour]);
    expect(result).toBe(false);
  });

  it("returns false when provider has no start command", () => {
    const providerNoStart: WorkspaceProvider = {
      ...mockProvider,
      commands: {
        create: "test-cli create",
        destroy: "test-cli destroy",
        status: "test-cli status",
      },
    };
    const result = canResume(mockWorkspace, [providerNoStart]);
    expect(result).toBe(false);
  });

  it("returns false when provider start command is empty string", () => {
    const providerEmptyStart: WorkspaceProvider = {
      ...mockProvider,
      commands: {
        ...mockProvider.commands,
        start: "",
      },
    };
    const result = canResume(mockWorkspace, [providerEmptyStart]);
    expect(result).toBe(false);
  });
});

describe("interpolateProviderCommand", () => {
  it("replaces {binary} placeholder", () => {
    const template = "{binary} start";
    const result = interpolateProviderCommand(
      template,
      mockWorkspace,
      mockProvider,
    );
    expect(result).toBe("/usr/bin/test-cli start");
  });

  it("replaces {name} placeholder", () => {
    const template = "{binary} start {name}";
    const result = interpolateProviderCommand(
      template,
      mockWorkspace,
      mockProvider,
    );
    expect(result).toBe("/usr/bin/test-cli start test-workspace");
  });

  it("replaces {id} placeholder", () => {
    const template = "{binary} start --id {id}";
    const result = interpolateProviderCommand(
      template,
      mockWorkspace,
      mockProvider,
    );
    expect(result).toBe("/usr/bin/test-cli start --id remote-workspace-123");
  });

  it("replaces all placeholders", () => {
    const template = "{binary} start {name} --id {id}";
    const result = interpolateProviderCommand(
      template,
      mockWorkspace,
      mockProvider,
    );
    expect(result).toBe(
      "/usr/bin/test-cli start test-workspace --id remote-workspace-123",
    );
  });

  it("replaces multiple occurrences of same placeholder", () => {
    const template = "{binary} start {name} && {binary} status {id}";
    const result = interpolateProviderCommand(
      template,
      mockWorkspace,
      mockProvider,
    );
    expect(result).toBe(
      "/usr/bin/test-cli start test-workspace && /usr/bin/test-cli status remote-workspace-123",
    );
  });

  it("uses empty string for missing providerWorkspaceId", () => {
    const workspaceNoId = {
      ...mockWorkspace,
      providerMeta: { providerId: "provider-1" },
    };
    const template = "{binary} start --id {id}";
    const result = interpolateProviderCommand(
      template,
      workspaceNoId,
      mockProvider,
    );
    expect(result).toBe("/usr/bin/test-cli start --id ");
  });

  it("uses empty string when providerMeta is null", () => {
    const workspaceNoMeta = {
      ...mockWorkspace,
      providerMeta: null,
    };
    const template = "{binary} start --id {id}";
    const result = interpolateProviderCommand(
      template,
      workspaceNoMeta,
      mockProvider,
    );
    expect(result).toBe("/usr/bin/test-cli start --id ");
  });

  it("handles template with no placeholders", () => {
    const template = "static command";
    const result = interpolateProviderCommand(
      template,
      mockWorkspace,
      mockProvider,
    );
    expect(result).toBe("static command");
  });
});
