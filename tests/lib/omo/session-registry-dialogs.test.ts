// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import type { OmoRegistryEvent } from "@/lib/omo/session-registry";
import {
  createRegistryFixture,
  entriesFixture,
  openFixture,
  type RegistryFixture,
} from "@/tests/lib/omo/session-registry-fixture";

describe("OmoSessionRegistry live dialogs", () => {
  let fixture: RegistryFixture | undefined;

  afterEach(async () => {
    await fixture?.close();
    fixture = undefined;
  });

  it("emits question.asked for a mid-turn extension_ui_request on an already attached session", async () => {
    // Given an already-live binding
    fixture = await createRegistryFixture([
      openFixture({
        durableId: "dialog-session",
        routingHandle: "route-dialog",
        sessionPath: "/sessions/dialog.jsonl",
      }),
      entriesFixture([], null),
    ]);
    await fixture.runtime.registry.attach({
      workspace: fixture.workspace,
      durableId: "dialog-session",
      sessionPath: "/sessions/dialog.jsonl",
    });
    const events: OmoRegistryEvent[] = [];
    fixture.runtime.registry.subscribe(fixture.workspace.id, (event) =>
      events.push(event),
    );

    // When a mid-turn dialog request arrives on the workspace sink
    fixture.host.emit({
      type: "extension_ui_request",
      sessionId: "route-dialog",
      id: "uuid-mid-turn-1",
      method: "select",
      title: "Allow dangerous command?",
      options: ["Allow", "Block"],
    });

    // Then the live workspace sink receives question.asked, not just the ledger
    await vi.waitFor(() => {
      expect(events.some((event) => event.type === "question.asked")).toBe(
        true,
      );
    });
    const asked = events.find((event) => event.type === "question.asked");
    expect(asked).toMatchObject({
      type: "question.asked",
      properties: {
        sessionID: "omo_dialog-session",
        questions: [
          {
            header: "Allow dangerous command?",
            options: [
              { label: "Allow", description: "" },
              { label: "Block", description: "" },
            ],
          },
        ],
      },
    });
  });

  it("ignores fire-and-forget extension_ui_request methods like notify", async () => {
    // Given an already-live binding
    fixture = await createRegistryFixture([
      openFixture({
        durableId: "notify-session",
        routingHandle: "route-notify",
        sessionPath: "/sessions/notify.jsonl",
      }),
      entriesFixture([], null),
    ]);
    await fixture.runtime.registry.attach({
      workspace: fixture.workspace,
      durableId: "notify-session",
      sessionPath: "/sessions/notify.jsonl",
    });
    const events: OmoRegistryEvent[] = [];
    fixture.runtime.registry.subscribe(fixture.workspace.id, (event) =>
      events.push(event),
    );

    // When a fire-and-forget notify request arrives
    fixture.host.emit({
      type: "extension_ui_request",
      sessionId: "route-notify",
      id: "uuid-notify-1",
      method: "notify",
      message: "Command blocked by user",
      notifyType: "warning",
    });
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Then no question.asked is ever emitted for it
    expect(events.some((event) => event.type === "question.asked")).toBe(false);
  });
});
