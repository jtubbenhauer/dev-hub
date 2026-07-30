export interface SseSupervisorState {
  readonly state: "connected" | "retrying";
  readonly attempt: number;
  readonly retryInMs?: number;
}

interface SseSupervisorOptions {
  readonly signal: AbortSignal;
  readonly connect: (signal: AbortSignal) => Promise<Response>;
  readonly onData: (data: string) => void;
  readonly onState: (state: SseSupervisorState) => void;
  readonly wait?: (delayMs: number, signal: AbortSignal) => Promise<void>;
}

export async function superviseSseTarget(
  options: SseSupervisorOptions,
): Promise<void> {
  let attempt = 0;
  while (!options.signal.aborted) {
    try {
      const response = await options.connect(options.signal);
      if (!response.ok || !response.body) {
        throw new Error(`SSE upstream unavailable (${response.status})`);
      }

      const recoveredAfterAttempts = attempt;
      attempt = 0;
      options.onState({
        state: "connected",
        attempt: recoveredAfterAttempts,
      });
      await readSseData(response.body, options.signal, options.onData);
      if (options.signal.aborted) return;
      throw new Error("SSE upstream closed");
    } catch {
      if (options.signal.aborted) return;
      attempt += 1;
      const retryInMs = Math.min(1000 * 2 ** Math.min(attempt - 1, 5), 30000);
      options.onState({ state: "retrying", attempt, retryInMs });
      await (options.wait ?? waitForRetry)(retryInMs, options.signal);
    }
  }
}

async function readSseData(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  onData: (data: string) => void,
): Promise<void> {
  const reader = body.getReader();
  const cancelReader = () => void reader.cancel();
  signal.addEventListener("abort", cancelReader, { once: true });
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      if (buffer.length > 1024 * 1024) {
        buffer = buffer.slice(-512 * 1024);
      }

      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = block
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (data) onData(data);
        boundary = buffer.indexOf("\n\n");
      }
    }
  } finally {
    signal.removeEventListener("abort", cancelReader);
    reader.releaseLock();
  }
}

function waitForRetry(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(finish, delayMs);
    signal.addEventListener("abort", finish, { once: true });

    function finish() {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    }
  });
}
