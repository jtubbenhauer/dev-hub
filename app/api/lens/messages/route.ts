import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { getServerUrl } from "@/lib/opencode/client";
import type { MessageWithParts } from "@/lib/opencode/types";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const sessionId = url.searchParams.get("sessionId");

  if (!sessionId) {
    return NextResponse.json(
      { error: "sessionId query param required" },
      { status: 400 },
    );
  }

  try {
    const serverUrl = await getServerUrl();
    const response = await fetch(`${serverUrl}/session/${sessionId}/message`, {
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      const body = await response.text();
      return NextResponse.json(
        { error: "Failed to fetch messages", detail: body },
        { status: response.status },
      );
    }

    const messages: MessageWithParts[] = await response.json();
    return NextResponse.json(messages);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch messages";
    return NextResponse.json(
      { error: "Lens messages error", detail: message },
      { status: 502 },
    );
  }
}
