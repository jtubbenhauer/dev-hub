import { afterEach, describe, expect, it, vi } from "vitest";
import { getCatalog } from "@/lib/omo/adapter/catalog";
import {
  createRegistryFixture,
  entriesFixture,
  openFixture,
  recordsOfType,
  type RegistryFixture,
} from "@/tests/lib/omo/session-registry-fixture";
import {
  catalogFixtures,
  createStubSessionSource,
  waitForClientRecord,
} from "@/tests/lib/omo/adapter/catalog-fixture";

let fixture: RegistryFixture | undefined;

afterEach(async () => {
  vi.restoreAllMocks();
  await fixture?.close();
  fixture = undefined;
});

describe("getCatalog cache and open coordination", () => {
  it("caches within the TTL and shares one probe across concurrent callers", async () => {
    fixture = await createRegistryFixture(await catalogFixtures());
    const { runtime, workspacePath } = fixture;
    const { source } = createStubSessionSource(workspacePath);

    const catalogs = await Promise.all(
      Array.from({ length: 5 }, () =>
        getCatalog(runtime, workspacePath, source),
      ),
    );
    const cached = await getCatalog(runtime, workspacePath, source);

    expect(catalogs.every((catalog) => catalog === catalogs[0])).toBe(true);
    expect(cached).toBe(catalogs[0]);
    expect(recordsOfType(fixture, "open_session")).toHaveLength(1);
  });

  it("serializes a probe racing an attach through the registry open lock", async () => {
    const probeFixtures = await catalogFixtures();
    fixture = await createRegistryFixture([
      ...probeFixtures,
      openFixture({
        durableId: "attached",
        sessionPath: "/sessions/attached.jsonl",
      }),
      entriesFixture([], null),
    ]);
    const { source } = createStubSessionSource(fixture.workspacePath);

    await expect(
      Promise.all([
        getCatalog(fixture.runtime, fixture.workspacePath, source),
        fixture.runtime.registry.create({ workspace: fixture.workspace }),
      ]),
    ).resolves.toHaveLength(2);
    expect(recordsOfType(fixture, "open_session")).toHaveLength(2);
  });

  it("invalidates a warm cache on commands_changed", async () => {
    const oneProbe = await catalogFixtures();
    fixture = await createRegistryFixture([...oneProbe, ...oneProbe]);
    const { source } = createStubSessionSource(fixture.workspacePath);
    await getCatalog(fixture.runtime, fixture.workspacePath, source);
    const received = waitForClientRecord(fixture.runtime, "commands_changed");

    fixture.host.emit({ type: "commands_changed" });
    await received;
    await getCatalog(fixture.runtime, fixture.workspacePath, source);

    expect(recordsOfType(fixture, "open_session")).toHaveLength(2);
  });

  it("returns stale data when a warm refresh hits host memory pressure", async () => {
    fixture = await createRegistryFixture([
      ...(await catalogFixtures()),
      ...(await catalogFixtures({
        openError: { code: "host_memory_pressure", retryAfterMs: 2750 },
      })),
    ]);
    const { source } = createStubSessionSource(fixture.workspacePath);
    const warm = await getCatalog(
      fixture.runtime,
      fixture.workspacePath,
      source,
    );
    const expiredTime = Date.now() + 300_001;
    vi.spyOn(Date, "now").mockReturnValue(expiredTime);

    await expect(
      getCatalog(fixture.runtime, fixture.workspacePath, source),
    ).resolves.toBe(warm);
  });

  it("surfaces retry metadata when a cold probe hits memory pressure", async () => {
    fixture = await createRegistryFixture(
      await catalogFixtures({
        openError: { code: "host_memory_pressure", retryAfterMs: 2750 },
      }),
    );
    const { source } = createStubSessionSource(fixture.workspacePath);

    await expect(
      getCatalog(fixture.runtime, fixture.workspacePath, source),
    ).rejects.toMatchObject({
      errorCode: "host_memory_pressure",
      errorData: { retry_after_ms: 2750 },
    });
  });
});
