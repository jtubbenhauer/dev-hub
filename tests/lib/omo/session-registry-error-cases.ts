import { afterEach, describe, expect, it } from "vitest";
import {
  createRegistryFixture,
  entriesFixture,
  insertIndexRow,
  openFixture,
  recordsOfType,
  type RegistryFixture,
} from "@/tests/lib/omo/session-registry-fixture";

describe("OmoSessionRegistry attach errors", () => {
  let fixture: RegistryFixture | undefined;

  afterEach(async () => {
    await fixture?.close();
    fixture = undefined;
  });

  it("rejects corrupt authoritative worker context before opening", async () => {
    fixture = await createRegistryFixture([]);
    insertIndexRow(fixture.sqlite, {
      durableId: "corrupt",
      sessionPath: "/sessions/corrupt.jsonl",
      kind: "worker",
      context: '{"a":1}',
      contextAuthoritative: 1,
    });

    await expect(
      fixture.runtime.registry.attach({
        workspace: fixture.workspace,
        durableId: "corrupt",
      }),
    ).rejects.toMatchObject({
      name: "OmoCorruptIndexRowError",
      workspaceId: "workspace-1",
      durableId: "corrupt",
    });
    expect(recordsOfType(fixture, "open_session")).toHaveLength(0);
  });

  it("rejects a replaced durable id before opening", async () => {
    fixture = await createRegistryFixture([]);
    insertIndexRow(fixture.sqlite, {
      durableId: "old",
      sessionPath: "/sessions/old.jsonl",
      replacedByDurableId: "new",
    });

    await expect(
      fixture.runtime.registry.attach({
        workspace: fixture.workspace,
        durableId: "old",
      }),
    ).rejects.toMatchObject({
      name: "OmoSessionReplacedError",
      newDurableId: "new",
    });
    expect(recordsOfType(fixture, "open_session")).toHaveLength(0);
  });

  it("rejects an opened file whose durable identity differs", async () => {
    fixture = await createRegistryFixture([
      openFixture({
        durableId: "actual",
        sessionPath: "/sessions/shared.jsonl",
      }),
    ]);

    await expect(
      fixture.runtime.registry.attach({
        workspace: fixture.workspace,
        durableId: "requested",
        sessionPath: "/sessions/shared.jsonl",
      }),
    ).rejects.toMatchObject({
      name: "OmoSessionIdentityConflictError",
      workspaceId: "workspace-1",
      durableId: "requested",
      sessionPath: "/sessions/shared.jsonl",
    });
  });

  it("rejects a canonical workspace path owned by another workspace", async () => {
    fixture = await createRegistryFixture([
      openFixture({ durableId: "first", sessionPath: "/sessions/first.jsonl" }),
      entriesFixture([], null),
    ]);
    await fixture.runtime.registry.attach({
      workspace: fixture.workspace,
      sessionPath: "/sessions/first.jsonl",
    });
    const secondWorkspace = fixture.addWorkspace("workspace-2");

    await expect(
      fixture.runtime.registry.attach({
        workspace: secondWorkspace,
        sessionPath: "/sessions/second.jsonl",
      }),
    ).rejects.toMatchObject({
      name: "OmoWorkspacePathConflictError",
      owningWorkspaceId: "workspace-1",
      requestedWorkspaceId: "workspace-2",
    });
    expect(recordsOfType(fixture, "open_session")).toHaveLength(1);
  });
});
