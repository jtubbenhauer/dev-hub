import { access } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getCatalog } from "@/lib/omo/adapter/catalog";
import { LocalFsSessionSource } from "@/lib/omo/session-source";
import { encodeCwdDir } from "@/lib/omo/sessions-on-disk";
import {
  createRegistryFixture,
  recordsOfType,
  type RegistryFixture,
} from "@/tests/lib/omo/session-registry-fixture";
import {
  catalogFixtures,
  createStubSessionSource,
  withProbeOpen,
  writeProbeSession,
} from "@/tests/lib/omo/adapter/catalog-fixture";

let fixture: RegistryFixture | undefined;

afterEach(async () => {
  vi.restoreAllMocks();
  await fixture?.close();
  fixture = undefined;
});

describe("getCatalog shapes and cleanup", () => {
  it("replays the catalog fixture into consumer shapes and cleans up the probe", async () => {
    fixture = await createRegistryFixture(
      await catalogFixtures({
        commands: [
          {
            name: "debugging",
            description: "Debug runtime failures",
            source: "skill",
          },
          {
            name: "fix-tests",
            description: "Fix failing tests",
            source: "prompt",
          },
        ],
        mcpServers: [{ name: "filesystem", status: "connected" }],
      }),
    );
    const { source, removeProbeSession } = createStubSessionSource(
      fixture.workspacePath,
    );

    const catalog = await getCatalog(
      fixture.runtime,
      fixture.workspacePath,
      source,
    );

    expect(catalog.providers).toEqual({
      providers: [
        {
          id: "openai",
          name: "openai",
          models: {
            "gpt-5.6-sol": {
              id: "gpt-5.6-sol",
              name: "GPT-5.6 Sol",
              variants: { off: {}, low: {}, medium: {}, high: {} },
            },
          },
        },
      ],
      default: { openai: "gpt-5.6-sol" },
    });
    expect(catalog.agents).toEqual([
      {
        name: "skill:debugging",
        description: "Debug runtime failures",
        mode: "primary",
      },
    ]);
    expect(catalog.commands).toEqual([
      { name: "fix-tests", description: "Fix failing tests" },
    ]);
    expect(catalog.mcp).toEqual({ filesystem: { status: "connected" } });
    expect(recordsOfType(fixture, "close_session")).toHaveLength(1);
    expect(removeProbeSession).toHaveBeenCalledWith(
      "durable-catalog-1",
      "/TMP/catalog.jsonl",
    );
  });

  it("queries thinking levels for a model that does not report them", async () => {
    fixture = await createRegistryFixture(
      await catalogFixtures({
        models: [
          { provider: "openai", id: "fallback-model", name: "Fallback" },
        ],
      }),
    );
    const { source } = createStubSessionSource(fixture.workspacePath);

    const catalog = await getCatalog(
      fixture.runtime,
      fixture.workspacePath,
      source,
    );

    expect(
      catalog.providers.providers[0]?.models["fallback-model"]?.variants,
    ).toEqual({ off: {}, minimal: {}, low: {}, medium: {}, high: {} });
    expect(
      recordsOfType(fixture, "get_available_thinking_levels")[0],
    ).toMatchObject({ provider: "openai", modelId: "fallback-model" });
  });

  it.each([false, true])(
    "removes a local probe file with omitted sessionFile: %s",
    async (omitSessionFile) => {
      const baseFixtures = await catalogFixtures();
      let expectedSessionFile = "";
      let agentDir = "";
      fixture = await createRegistryFixture((workspacePath) => {
        agentDir = join(workspacePath, "agent");
        expectedSessionFile = join(
          agentDir,
          "sessions",
          `--${encodeCwdDir(workspacePath)}--`,
          "local-probe.jsonl",
        );
        return withProbeOpen(baseFixtures, {
          durableId: "local-probe",
          ...(omitSessionFile
            ? { omitSessionFile: true }
            : { sessionFile: expectedSessionFile }),
        });
      });
      const actualSessionFile = await writeProbeSession(
        agentDir,
        fixture.workspacePath,
        "local-probe",
      );
      expect(actualSessionFile).toBe(expectedSessionFile);
      const source = new LocalFsSessionSource({
        agentDir,
        workspacePath: fixture.workspacePath,
      });

      await getCatalog(fixture.runtime, fixture.workspacePath, source);

      await expect(access(actualSessionFile)).rejects.toMatchObject({
        code: "ENOENT",
      });
    },
  );

  it("delegates cleanup to a remote source without calling fs.rm", async () => {
    fixture = await createRegistryFixture(await catalogFixtures());
    const { source, removeProbeSession } = createStubSessionSource(
      fixture.workspacePath,
    );
    const removeFile = vi.fn();
    vi.resetModules();
    vi.doMock("node:fs/promises", async (importOriginal) => ({
      ...(await importOriginal<typeof import("node:fs/promises")>()),
      rm: removeFile,
    }));
    const { getCatalog: getRemoteCatalog } =
      await import("@/lib/omo/adapter/catalog");

    try {
      await getRemoteCatalog(fixture.runtime, fixture.workspacePath, source);
    } finally {
      vi.doUnmock("node:fs/promises");
    }

    expect(removeProbeSession).toHaveBeenCalledOnce();
    expect(removeFile).not.toHaveBeenCalled();
  });
});
