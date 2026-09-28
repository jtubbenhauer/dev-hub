const LOOPBACK_HOSTNAMES = new Set(["localhost", "::1", "[::1]"]);
const LOOPBACK_IPV4_PATTERN = /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
const SECURE_PROTOCOLS = new Set(["https:", "wss:"]);

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return (
    LOOPBACK_HOSTNAMES.has(normalized) || LOOPBACK_IPV4_PATTERN.test(normalized)
  );
}

function normalizedOriginProtocol(protocol: string): string {
  if (protocol === "ws:") return "http:";
  if (protocol === "wss:") return "https:";
  return protocol;
}

function normalizedOrigin(url: URL): string {
  return `${normalizedOriginProtocol(url.protocol)}//${url.host}`;
}

function parseAllowedOrigins(raw: string | undefined): ReadonlySet<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
  );
}

function parseAgentUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

// A loopback URL is always trusted regardless of scheme (local dev has no TLS).
// A non-loopback URL is trusted only when it uses a secure scheme (https/wss)
// AND its origin (scheme+host+port, with ws/wss normalized to http/https)
// appears in DEVHUB_AGENT_ALLOWED_ORIGINS.
export function isTrustedAgentOrigin(url: string): boolean {
  const parsed = parseAgentUrl(url);
  if (parsed === null) return false;
  if (isLoopbackHostname(parsed.hostname)) return true;
  if (!SECURE_PROTOCOLS.has(parsed.protocol)) return false;

  const allowedOrigins = parseAllowedOrigins(
    process.env.DEVHUB_AGENT_ALLOWED_ORIGINS,
  );
  return allowedOrigins.has(normalizedOrigin(parsed));
}

// Scheme-only check used at workspace create/update time: a non-loopback
// agentUrl must use https (or wss), independent of the allowlist.
export function isSecureOrLoopbackAgentUrl(url: string): boolean {
  const parsed = parseAgentUrl(url);
  if (parsed === null) return false;
  if (isLoopbackHostname(parsed.hostname)) return true;
  return SECURE_PROTOCOLS.has(parsed.protocol);
}
