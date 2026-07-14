// Aborts if the upstream doesn't return response headers within timeoutMs, but
// clears the timer as soon as headers arrive so streaming a large body to a
// slow client (e.g. mobile over a tunnel downloading a big message list) never
// trips the abort mid-download. The abort reason is a TimeoutError so callers
// can classify it as a 504.
export async function fetchWithHeaderTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new DOMException("Header timeout", "TimeoutError")),
    timeoutMs,
  );
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
