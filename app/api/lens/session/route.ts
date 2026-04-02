import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { getOpenCodeClient, getServerUrl } from "@/lib/opencode/client";
import type { Session } from "@/lib/opencode/types";

const LENS_SESSION_TITLE = "[lens]";

let cachedSessionId: string | null = null;

async function findLensSession(): Promise<Session | null> {
  const client = await getOpenCodeClient();
  const response = await client.session.list();
  const sessions = response.data ?? [];

  return (
    sessions.find((session) => session.title === LENS_SESSION_TITLE) ?? null
  );
}

async function createLensSession(): Promise<Session> {
  const serverUrl = await getServerUrl();

  const response = await fetch(`${serverUrl}/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: LENS_SESSION_TITLE }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to create lens session: ${body}`);
  }

  return response.json() as Promise<Session>;
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    if (cachedSessionId) {
      const client = await getOpenCodeClient();
      try {
        const response = await client.session.get({
          path: { id: cachedSessionId },
        });
        if (response.data) {
          return NextResponse.json(response.data);
        }
      } catch {
        cachedSessionId = null;
      }
    }

    const existing = await findLensSession();
    if (existing) {
      cachedSessionId = existing.id;
      return NextResponse.json(existing);
    }

    return NextResponse.json(null);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to get session";
    return NextResponse.json(
      { error: "Lens session error", detail: message },
      { status: 503 },
    );
  }
}

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const existing = await findLensSession();
    if (existing) {
      cachedSessionId = existing.id;
      return NextResponse.json(existing);
    }

    const lensSession = await createLensSession();
    cachedSessionId = lensSession.id;
    return NextResponse.json(lensSession);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create session";
    return NextResponse.json(
      { error: "Lens session error", detail: message },
      { status: 503 },
    );
  }
}
