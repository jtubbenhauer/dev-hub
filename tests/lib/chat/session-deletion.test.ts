import { describe, expect, it } from "vitest";

import {
  OMO_SESSION_IN_USE_MESSAGE,
  readSessionDeletionFailureMessage,
  SESSION_DELETION_FAILED_MESSAGE,
} from "@/lib/chat/session-deletion";

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("readSessionDeletionFailureMessage", () => {
  it("explains a 409 session_in_use from the omo facade", async () => {
    await expect(
      readSessionDeletionFailureMessage(
        jsonResponse({ error: "session_in_use" }, 409),
      ),
    ).resolves.toBe("Session is open in another omo client");
    expect(OMO_SESSION_IN_USE_MESSAGE).toBe(
      "Session is open in another omo client",
    );
  });

  it("keeps the generic message for other 409 conflicts", async () => {
    await expect(
      readSessionDeletionFailureMessage(
        jsonResponse({ error: "session_not_resolvable" }, 409),
      ),
    ).resolves.toBe(SESSION_DELETION_FAILED_MESSAGE);
  });

  it("keeps the generic message for a 409 without a JSON error code", async () => {
    await expect(
      readSessionDeletionFailureMessage(new Response("busy", { status: 409 })),
    ).resolves.toBe(SESSION_DELETION_FAILED_MESSAGE);
    await expect(
      readSessionDeletionFailureMessage(jsonResponse({ error: 409 }, 409)),
    ).resolves.toBe(SESSION_DELETION_FAILED_MESSAGE);
  });

  it("does not read the body of non-409 failures", async () => {
    const response = jsonResponse({ error: "session_in_use" }, 503);

    await expect(readSessionDeletionFailureMessage(response)).resolves.toBe(
      "Failed to delete chat",
    );
    expect(response.bodyUsed).toBe(false);
  });
});
