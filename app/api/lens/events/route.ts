import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { getServerUrl } from "@/lib/opencode/client";

export const maxDuration = 300;

const KEEPALIVE_INTERVAL_MS = 30_000;
const MAX_BUFFER_SIZE = 1024 * 1024;

function safeEnqueue(
  controller: ReadableStreamDefaultController<Uint8Array>,
  chunk: Uint8Array,
  cancelled: { current: boolean },
) {
  if (cancelled.current) return;
  try {
    controller.enqueue(chunk);
  } catch {
    cancelled.current = true;
  }
}

async function readUpstream(
  url: string,
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  signal: AbortSignal,
  cancelled: { current: boolean },
): Promise<void> {
  try {
    const response = await fetch(url, {
      headers: { accept: "text/event-stream" },
      signal,
    });
    if (!response.body) return;

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (!signal.aborted && !cancelled.current) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      if (buffer.length > MAX_BUFFER_SIZE) {
        buffer = "";
        continue;
      }

      for (
        let idx = buffer.indexOf("\n\n");
        idx !== -1;
        idx = buffer.indexOf("\n\n")
      ) {
        const block = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);

        for (const line of block.split("\n")) {
          if (line.startsWith("data:")) {
            const data = line.slice(5).trimStart();
            try {
              JSON.parse(data);
              safeEnqueue(
                controller,
                encoder.encode(`data: ${data}\n\n`),
                cancelled,
              );
            } catch {
              continue;
            }
          }
        }
      }
    }
  } catch (err) {
    if (!signal.aborted) {
      console.error(
        "[lens-sse] Upstream disconnected:",
        err instanceof Error ? err.message : err,
      );
    }
  }
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let serverUrl: string;
  try {
    serverUrl = await getServerUrl();
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to get server URL";
    return NextResponse.json(
      { error: "OpenCode server unavailable", detail: message },
      { status: 503 },
    );
  }

  const eventUrl = `${serverUrl}/event`;
  const abortController = new AbortController();
  const encoder = new TextEncoder();
  const cancelled = { current: false };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const keepalive = setInterval(() => {
        safeEnqueue(controller, encoder.encode(`: keepalive\n\n`), cancelled);
      }, KEEPALIVE_INTERVAL_MS);

      readUpstream(
        eventUrl,
        controller,
        encoder,
        abortController.signal,
        cancelled,
      ).then(() => {
        clearInterval(keepalive);
        if (!cancelled.current) {
          try {
            controller.close();
          } catch {
            // Stream already closed
          }
        }
      });
    },
    cancel() {
      cancelled.current = true;
      abortController.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
}
