import { beforeEach, describe, expect, it, vi } from "vitest";

const mockUpdateWhere = vi.fn().mockResolvedValue(undefined);
const mockSet = vi.fn(() => ({ where: mockUpdateWhere }));
const mockUpdate = vi.fn(() => ({ set: mockSet }));

vi.mock("@/lib/db", () => ({ db: { update: mockUpdate } }));
vi.mock("@/drizzle/schema", () => ({
  workspaces: { name: "workspaces", id: "id" },
}));
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((column, value) => ({ column, value })),
}));

const mockReadSshConfig = vi.fn();
vi.mock("@/lib/ssh-config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ssh-config")>();
  return { ...actual, readSshConfig: mockReadSshConfig };
});

const { backfillSshTargets, getSshHost, getSshMatchKeys } =
  await import("@/lib/workspaces/ssh-target");

type Row = Parameters<typeof backfillSshTargets>[0][number];

function row(overrides: Partial<Row> = {}): Row {
  return {
    id: "ws-1",
    name: "ai-proof-of-concept",
    backend: "remote",
    path: "/home/dev/code",
    agentUrl: "http://dev-rig:10001",
    sshTarget: null,
    sshPath: null,
    providerMeta: {
      host: "dev-rig",
      containerId: "69-oc-ai-proof-of-concept",
    },
    ...overrides,
  } as Row;
}

const CONFIG_ENTRIES = [
  {
    alias: "devrig-69-ws-ai-proof-of-concept",
    hostName: "dev-rig",
    port: 28901,
    user: "dev",
  },
];

describe("getSshHost", () => {
  it("prefers the provider-recorded host", () => {
    expect(getSshHost(row())).toBe("dev-rig");
  });

  it("falls back to the agent url hostname", () => {
    expect(getSshHost(row({ providerMeta: null }))).toBe("dev-rig");
  });

  it("returns null when there is nothing to derive from", () => {
    expect(getSshHost(row({ providerMeta: null, agentUrl: null }))).toBeNull();
  });

  it("returns null for a malformed agent url", () => {
    expect(
      getSshHost(row({ providerMeta: null, agentUrl: "not a url" })),
    ).toBeNull();
  });
});

describe("getSshMatchKeys", () => {
  it("orders container id ahead of workspace name", () => {
    expect(getSshMatchKeys(row())).toEqual([
      "69-oc-ai-proof-of-concept",
      "ai-proof-of-concept",
    ]);
  });

  it("includes the provider workspace id when present", () => {
    const keys = getSshMatchKeys(
      row({
        providerMeta: {
          host: "dev-rig",
          containerId: "69-oc-thing",
          providerWorkspaceId: "69-oc-thing-alt",
        },
      }),
    );
    expect(keys).toEqual([
      "69-oc-thing",
      "69-oc-thing-alt",
      "ai-proof-of-concept",
    ]);
  });

  it("falls back to just the name with no provider metadata", () => {
    expect(getSshMatchKeys(row({ providerMeta: null }))).toEqual([
      "ai-proof-of-concept",
    ]);
  });
});

describe("backfillSshTargets", () => {
  beforeEach(() => {
    mockUpdate.mockClear();
    mockSet.mockClear();
    mockUpdateWhere.mockClear();
    mockReadSshConfig.mockReset();
    mockReadSshConfig.mockResolvedValue(CONFIG_ENTRIES);
  });

  it("resolves and persists a missing ssh target", async () => {
    const result = await backfillSshTargets([row()]);
    expect(result[0].sshTarget).toBe("devrig-69-ws-ai-proof-of-concept");
    expect(mockSet).toHaveBeenCalledWith({
      sshTarget: "devrig-69-ws-ai-proof-of-concept",
    });
  });

  it("never reads the ssh config when nothing needs backfilling", async () => {
    await backfillSshTargets([row({ sshTarget: "already-set" })]);
    expect(mockReadSshConfig).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("leaves an existing target untouched", async () => {
    const result = await backfillSshTargets([row({ sshTarget: "manual" })]);
    expect(result[0].sshTarget).toBe("manual");
  });

  it("ignores local workspaces", async () => {
    const result = await backfillSshTargets([row({ backend: "local" })]);
    expect(result[0].sshTarget).toBeNull();
    expect(mockReadSshConfig).not.toHaveBeenCalled();
  });

  it("does not write when nothing resolves", async () => {
    mockReadSshConfig.mockResolvedValue([
      { alias: "unrelated", hostName: "other", port: 22, user: null },
    ]);
    const result = await backfillSshTargets([row()]);
    expect(result[0].sshTarget).toBeNull();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("does not write when the ssh config is empty or unreadable", async () => {
    mockReadSshConfig.mockResolvedValue([]);
    const result = await backfillSshTargets([row()]);
    expect(result[0].sshTarget).toBeNull();
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
