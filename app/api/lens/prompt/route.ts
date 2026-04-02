import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { getServerUrl } from "@/lib/opencode/client";
import { LENS_SYSTEM_PROMPT } from "@/lib/lens/system-prompt";

interface LensPromptBody {
  sessionId: string;
  text: string;
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: LensPromptBody;
  try {
    body = (await request.json()) as LensPromptBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.sessionId || !body.text) {
    return NextResponse.json(
      { error: "sessionId and text are required" },
      { status: 400 },
    );
  }

  try {
    const serverUrl = await getServerUrl();

    const promptBody = {
      parts: [{ type: "text" as const, text: body.text }],
      system: LENS_SYSTEM_PROMPT,
    };

    const upstream = await fetch(
      `${serverUrl}/session/${body.sessionId}/prompt_async`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(promptBody),
        signal: AbortSignal.timeout(15_000),
      },
    );

    if (upstream.status === 204 || upstream.status === 304) {
      return new Response(null, { status: upstream.status });
    }

    if (!upstream.ok) {
      const errorText = await upstream.text();
      return NextResponse.json(
        { error: "Prompt failed", detail: errorText },
        { status: upstream.status },
      );
    }

    return new Response(null, { status: 204 });
  } catch (error) {
    const isTimeout =
      error instanceof DOMException && error.name === "TimeoutError";
    const message =
      error instanceof Error ? error.message : "Prompt request failed";
    return NextResponse.json(
      { error: "Lens prompt error", detail: message },
      { status: isTimeout ? 504 : 502 },
    );
  }
}
