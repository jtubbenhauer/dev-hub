import { describe, expect, it } from "vitest";
import { readJson, useReadFixture } from "@/tests/lib/omo/facade/read-fixture";

describe("handleOmoRead catalog routes", () => {
  it("projects one cached catalog into every SDK catalog endpoint", async () => {
    // Given
    const fixture = await useReadFixture();
    fixture.getCatalog.mockResolvedValue({
      providers: {
        providers: [
          {
            id: "provider",
            name: "Provider",
            models: {
              model: { id: "model", name: "Model", variants: { high: {} } },
            },
          },
        ],
        default: { provider: "model" },
      },
      agents: [{ name: "skill:plan", description: "Plan", mode: "primary" }],
      commands: [{ name: "review", description: "Review" }],
      mcp: { browser: { status: "connected" } },
    });

    // When
    const commands = await fixture.request("/command");
    const agents = await fixture.request("/agent");
    const providers = await fixture.request("/config/providers");
    const mcp = await fixture.request("/mcp");

    // Then
    expect(await readJson(commands)).toEqual([
      { name: "review", description: "Review" },
    ]);
    expect(await readJson(agents)).toMatchObject([{ name: "skill:plan" }]);
    expect(await readJson(providers)).toMatchObject({
      providers: [{ id: "provider" }],
    });
    expect(await readJson(mcp)).toEqual({
      browser: { status: "connected" },
    });
    expect(fixture.getCatalog).toHaveBeenCalledTimes(4);
  });

  it("returns engine_unavailable for every catalog route when the socket is missing", async () => {
    // Given
    const fixture = await useReadFixture();
    fixture.getCatalog.mockRejectedValue(
      Object.assign(new Error("connect ENOENT"), { code: "ENOENT" }),
    );

    // When / Then
    for (const path of ["/config/providers", "/agent", "/command", "/mcp"]) {
      const response = await fixture.request(path);
      expect(response.status).toBe(503);
      expect(await readJson(response)).toEqual({
        error: "engine_unavailable",
      });
    }
  });
});
