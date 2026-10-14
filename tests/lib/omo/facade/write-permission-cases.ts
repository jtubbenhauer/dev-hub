import { describe, expect, it } from "vitest";
import type { JsonlRecord } from "@/lib/omo/jsonl";
import {
  useWriteFixture,
  writeJson,
  type WriteFixture,
} from "@/tests/lib/omo/facade/write-fixture";

function registerEditPrompt(fixture: WriteFixture, workspaceId: string) {
  fixture.source.authorized.add("root");
  return fixture.dialogLedger.registerPermission({
    routingHandle: "route-root",
    durableId: "root",
    workspaceId,
    extUiId: "ui-edit-1",
    request: {
      sessionID: "omo_root",
      permission: "edit",
      patterns: ["/workspace/notes.txt"],
      always: ["/workspace/notes.txt"],
      metadata: { toolCallId: "call-write-1" },
    },
  });
}

function lastFireAndForget(fixture: WriteFixture): JsonlRecord | undefined {
  return fixture.client.sendFireAndForget.mock.calls.at(-1)?.[0];
}

describe("handleOmoWrite permission replies", () => {
  it.each([
    { response: "once", label: "Allow once" },
    { response: "always", label: "Allow always" },
    { response: "reject", label: "Deny" },
  ] as const)(
    "answers the $response reply with omo's $label option",
    async ({ response, label }) => {
      // Given
      const fixture = await useWriteFixture();
      const entry = registerEditPrompt(fixture, fixture.workspace.id);

      // When
      const result = await fixture.request(
        `/session/omo_root/permissions/${entry.publicId}`,
        { body: { response } },
      );

      // Then
      expect(result.status).toBe(200);
      expect(await writeJson(result)).toBe(true);
      expect(lastFireAndForget(fixture)).toEqual({
        type: "extension_ui_response",
        id: "ui-edit-1",
        sessionId: "route-root",
        value: label,
      });
      expect(fixture.registry.emitEvent).toHaveBeenCalledWith("workspace-1", {
        type: "permission.replied",
        properties: {
          sessionID: "omo_root",
          requestID: entry.publicId,
          reply: response,
        },
      });
      expect(fixture.dialogLedger.findPermission(entry.publicId)).toBe(
        undefined,
      );
    },
  );

  it("returns permission_not_found for an unknown or foreign prompt", async () => {
    // Given
    const fixture = await useWriteFixture();
    const foreign = registerEditPrompt(fixture, "workspace-2");

    // When
    const missing = await fixture.request(
      "/session/omo_root/permissions/dh_p_missing",
      { body: { response: "once" } },
    );
    const other = await fixture.request(
      `/session/omo_root/permissions/${foreign.publicId}`,
      { body: { response: "once" } },
    );

    // Then
    expect(missing.status).toBe(404);
    expect(await writeJson(missing)).toEqual({
      error: "permission_not_found",
    });
    expect(other.status).toBe(404);
    expect(fixture.client.sendFireAndForget).not.toHaveBeenCalled();
  });

  it("rejects a reply it does not understand without answering omo", async () => {
    // Given
    const fixture = await useWriteFixture();
    const entry = registerEditPrompt(fixture, fixture.workspace.id);

    // When
    const result = await fixture.request(
      `/session/omo_root/permissions/${entry.publicId}`,
      { body: { response: "maybe" } },
    );

    // Then
    expect(result.status).toBe(400);
    expect(fixture.client.sendFireAndForget).not.toHaveBeenCalled();
    expect(fixture.dialogLedger.findPermission(entry.publicId)).toBe(entry);
  });
});
