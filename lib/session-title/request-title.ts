import type { SessionTitleContext } from "@/lib/session-title/context";

export type SessionTitleTrigger =
  | { kind: "auto"; turn: number }
  | { kind: "regenerate" };

export type SessionTitleResult =
  | { kind: "titled"; title: string }
  | { kind: "skipped"; reason: string }
  | { kind: "failed"; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function requestSessionTitle(options: {
  workspaceId: string;
  sessionId: string;
  currentTitle: string;
  trigger: SessionTitleTrigger;
  context: SessionTitleContext;
}): Promise<SessionTitleResult> {
  const { workspaceId, sessionId, currentTitle, trigger, context } = options;
  const response = await fetch(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/session-title`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        trigger: trigger.kind,
        ...(trigger.kind === "auto" ? { turn: trigger.turn } : {}),
        currentTitle,
        userTurnCount: context.userTurnCount,
        sessionSpanMs: context.sessionSpanMs,
        userMessages: context.userMessages,
        agentMessages: context.agentMessages,
      }),
    },
  );
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error =
      isRecord(body) && typeof body.error === "string"
        ? body.error
        : `Title request failed (${response.status})`;
    return { kind: "failed", error };
  }
  if (isRecord(body) && typeof body.title === "string") {
    return { kind: "titled", title: body.title };
  }
  return {
    kind: "skipped",
    reason:
      isRecord(body) && typeof body.skipped === "string"
        ? body.skipped
        : "unknown",
  };
}
