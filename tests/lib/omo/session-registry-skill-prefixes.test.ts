// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import { getCatalog } from "@/lib/omo/adapter/catalog";
import type { OmoRegistryEvent } from "@/lib/omo/session-registry";
import {
  catalogFixtures,
  createStubSessionSource,
} from "@/tests/lib/omo/adapter/catalog-fixture";
import {
  createRegistryFixture,
  entriesFixture,
  openFixture,
  type RegistryFixture,
} from "@/tests/lib/omo/session-registry-fixture";

describe("OmoSessionRegistry live-adapter skill prefixes", () => {
  let fixture: RegistryFixture | undefined;

  afterEach(async () => {
    await fixture?.close();
    fixture = undefined;
  });

  it("detects a real catalog skill name once the catalog is warm", async () => {
    // Given a warm catalog exposing one skill named "ulw-plan"
    fixture = await createRegistryFixture([
      ...(await catalogFixtures({
        commands: [
          { name: "ulw-plan", description: "Plan work", source: "skill" },
        ],
      })),
      openFixture({
        durableId: "chat-1",
        sessionPath: "/sessions/chat-1.jsonl",
      }),
      entriesFixture([], null),
    ]);
    const { source } = createStubSessionSource(fixture.workspacePath);
    await getCatalog(fixture.runtime, fixture.workspacePath, source);

    const events: OmoRegistryEvent[] = [];
    fixture.runtime.registry.subscribe(fixture.workspace.id, (event) =>
      events.push(event),
    );

    // When a binding created after the catalog warms receives a $skill turn
    await fixture.runtime.registry.attach({
      workspace: fixture.workspace,
      durableId: "chat-1",
      sessionPath: "/sessions/chat-1.jsonl",
    });
    fixture.host.emit({
      type: "message_start",
      sessionId: "route-chat-1",
      message: { role: "user", content: "$ulw-plan hello", timestamp: 1 },
    });

    // Then the real skill name (not the empty-array default) is detected
    await vi.waitFor(() => {
      const textPart = events.find(
        (event) =>
          event.type === "message.part.updated" &&
          event.properties.part.type === "text",
      );
      expect(textPart).toBeDefined();
    });
    const textPart = events.find(
      (event) =>
        event.type === "message.part.updated" &&
        event.properties.part.type === "text",
    );
    const userUpdate = events.find(
      (event) =>
        event.type === "message.updated" &&
        event.properties.info.role === "user",
    );

    expect(textPart).toMatchObject({
      properties: { part: { text: "hello" } },
    });
    expect(userUpdate).toMatchObject({
      properties: { info: { agent: "skill:ulw-plan" } },
    });
  });
});
