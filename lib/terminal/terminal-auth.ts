import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// AUTH_SECRET keys the HMAC so a PTY server adopted from another dev process accepts our tokens.

export const TERMINAL_ADMIN_SCOPE = "admin";
export const TERMINAL_SOCKET_TOKEN_TTL_MS = 60_000;
export const TERMINAL_ADMIN_TOKEN_TTL_MS = 30_000;

const FALLBACK_SECRET_KEY = Symbol.for("devhub.terminal.fallbackSecret");

function getTokenSecret(): string {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  const globalStore = globalThis as { [FALLBACK_SECRET_KEY]?: string };
  globalStore[FALLBACK_SECRET_KEY] ??= randomBytes(32).toString("hex");
  return globalStore[FALLBACK_SECRET_KEY];
}

export function terminalSocketScope(workspaceId: string): string {
  return `socket:${workspaceId}`;
}

function sign(scope: string, expiresAt: number): string {
  return createHmac("sha256", getTokenSecret())
    .update(`${scope}.${expiresAt}`)
    .digest("base64url");
}

export function createTerminalToken(
  scope: string,
  ttlMs: number,
  now: number = Date.now(),
): string {
  const expiresAt = now + ttlMs;
  return `${expiresAt}.${sign(scope, expiresAt)}`;
}

export function verifyTerminalToken(
  token: string | null | undefined,
  scope: string,
  now: number = Date.now(),
): boolean {
  if (!token) return false;
  const separator = token.indexOf(".");
  if (separator <= 0) return false;
  const expiresAt = Number(token.slice(0, separator));
  if (!Number.isFinite(expiresAt) || expiresAt < now) return false;
  const expected = Buffer.from(sign(scope, expiresAt));
  const actual = Buffer.from(token.slice(separator + 1));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

// Browsers always send Origin on upgrades; non-browser clients send none but still need a token.
export function isAllowedTerminalOrigin(
  origin: string | undefined,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (!origin) return true;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (LOOPBACK_HOSTNAMES.has(parsed.hostname)) return true;
  const allowedOrigins = [
    originOf(env.AUTH_URL),
    originOf(env.WEBAUTHN_ORIGIN),
    ...(env.DEVHUB_TERMINAL_ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((entry) => originOf(entry.trim())),
  ];
  return allowedOrigins.includes(parsed.origin);
}
