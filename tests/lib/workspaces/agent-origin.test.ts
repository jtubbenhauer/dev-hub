import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isSecureOrLoopbackAgentUrl,
  isTrustedAgentOrigin,
} from "@/lib/workspaces/agent-origin";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isTrustedAgentOrigin", () => {
  it("trusts loopback hostnames regardless of scheme", () => {
    expect(isTrustedAgentOrigin("http://localhost:7500")).toBe(true);
    expect(isTrustedAgentOrigin("ws://127.0.0.1:7500")).toBe(true);
    expect(isTrustedAgentOrigin("http://127.5.6.7:7500")).toBe(true);
    expect(isTrustedAgentOrigin("http://[::1]:7500")).toBe(true);
  });

  it("rejects a non-loopback origin when no allowlist is configured", () => {
    expect(isTrustedAgentOrigin("https://agent.example.com:7500")).toBe(false);
  });

  it("rejects a non-loopback http/ws origin even if allow-listed", () => {
    vi.stubEnv(
      "DEVHUB_AGENT_ALLOWED_ORIGINS",
      "https://agent.example.com:7500",
    );
    expect(isTrustedAgentOrigin("http://agent.example.com:7500")).toBe(false);
    expect(isTrustedAgentOrigin("ws://agent.example.com:7500")).toBe(false);
  });

  it("trusts a non-loopback https/wss origin that is exactly allow-listed", () => {
    vi.stubEnv(
      "DEVHUB_AGENT_ALLOWED_ORIGINS",
      "https://agent.example.com:7500, https://other.example.com:8000",
    );
    expect(isTrustedAgentOrigin("https://agent.example.com:7500")).toBe(true);
    expect(isTrustedAgentOrigin("wss://agent.example.com:7500")).toBe(true);
    expect(isTrustedAgentOrigin("https://other.example.com:8000")).toBe(true);
  });

  it("does not trust an origin absent from the allowlist", () => {
    vi.stubEnv(
      "DEVHUB_AGENT_ALLOWED_ORIGINS",
      "https://agent.example.com:7500",
    );
    expect(isTrustedAgentOrigin("https://evil.example.com:7500")).toBe(false);
  });

  it("returns false for an unparseable URL", () => {
    expect(isTrustedAgentOrigin("not-a-url")).toBe(false);
  });
});

describe("isSecureOrLoopbackAgentUrl", () => {
  it("allows http on loopback", () => {
    expect(isSecureOrLoopbackAgentUrl("http://localhost:7500")).toBe(true);
    expect(isSecureOrLoopbackAgentUrl("http://127.0.0.1:7500")).toBe(true);
  });

  it("rejects http on a non-loopback host", () => {
    expect(isSecureOrLoopbackAgentUrl("http://10.0.0.1:7500")).toBe(false);
  });

  it("allows https on a non-loopback host", () => {
    expect(isSecureOrLoopbackAgentUrl("https://10.0.0.1:7500")).toBe(true);
  });

  it("returns false for an unparseable URL", () => {
    expect(isSecureOrLoopbackAgentUrl("not-a-url")).toBe(false);
  });
});
