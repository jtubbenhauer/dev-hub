// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";
import {
  createTerminalToken,
  isAllowedTerminalOrigin,
  terminalSocketScope,
  verifyTerminalToken,
} from "@/lib/terminal/terminal-auth";

beforeAll(() => {
  process.env.AUTH_SECRET = "terminal-auth-test-secret";
});

describe("terminal tokens", () => {
  const scope = terminalSocketScope("ws-1");

  it("accepts a token for the scope it was issued for", () => {
    const token = createTerminalToken(scope, 60_000, 1_000);
    expect(verifyTerminalToken(token, scope, 2_000)).toBe(true);
  });

  it("rejects an expired token", () => {
    const token = createTerminalToken(scope, 60_000, 1_000);
    expect(verifyTerminalToken(token, scope, 61_001)).toBe(false);
  });

  it("rejects a token issued for another workspace", () => {
    const token = createTerminalToken(terminalSocketScope("ws-2"), 60_000);
    expect(verifyTerminalToken(token, scope)).toBe(false);
  });

  it("rejects a token whose expiry was tampered with", () => {
    const token = createTerminalToken(scope, 60_000, 1_000);
    const [, signature] = token.split(".");
    expect(verifyTerminalToken(`999999999999.${signature}`, scope, 2_000)).toBe(
      false,
    );
  });

  it.each([null, undefined, "", "garbage", "123"])(
    "rejects malformed token %s",
    (token) => {
      expect(verifyTerminalToken(token, scope)).toBe(false);
    },
  );
});

describe("isAllowedTerminalOrigin", () => {
  it.each([
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://[::1]:3000",
  ])("allows loopback origin %s", (origin) => {
    expect(isAllowedTerminalOrigin(origin, {})).toBe(true);
  });

  it("allows requests without an Origin header", () => {
    expect(isAllowedTerminalOrigin(undefined, {})).toBe(true);
  });

  it("rejects other websites", () => {
    expect(isAllowedTerminalOrigin("https://evil.example", {})).toBe(false);
  });

  it("allows the configured app origins", () => {
    const env = {
      AUTH_URL: "https://devhub.example/api/auth",
      DEVHUB_TERMINAL_ALLOWED_ORIGINS: "https://a.example, https://b.example",
    };
    expect(isAllowedTerminalOrigin("https://devhub.example", env)).toBe(true);
    expect(isAllowedTerminalOrigin("https://b.example", env)).toBe(true);
    expect(isAllowedTerminalOrigin("https://c.example", env)).toBe(false);
  });
});
