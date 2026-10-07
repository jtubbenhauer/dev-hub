// Headers only arrive after the body is sent, so the timer must also cover the
// upload. Budgeting for a 1 Mbps uplink stops a large attachment (a 10MB PDF is
// a ~14MB prompt) to a remote workspace from being aborted mid-upload.
const MIN_UPLOAD_BYTES_PER_SECOND = 125_000;

function getUploadAllowanceMs(body: RequestInit["body"]): number {
  if (typeof body !== "string") return 0;
  return Math.ceil(
    (Buffer.byteLength(body) / MIN_UPLOAD_BYTES_PER_SECOND) * 1000,
  );
}

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
    timeoutMs + getUploadAllowanceMs(options.body),
  );
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
