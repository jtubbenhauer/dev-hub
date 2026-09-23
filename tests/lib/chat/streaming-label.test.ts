import { describe, it, expect } from "vitest";

import {
  formatRetryLabel,
  normalizeRetryReason,
} from "@/lib/chat/streaming-label";

const NOW = 1_000_000;

describe("formatRetryLabel", () => {
  it("includes the retry reason sent by OpenCode", () => {
    const label = formatRetryLabel(
      {
        type: "retry",
        attempt: 2,
        message: "Provider is overloaded",
        next: NOW + 5_000,
      },
      NOW,
    );
    expect(label).toBe("Retrying... attempt 2 · 5s · Provider is overloaded");
  });

  it("omits the countdown once the retry time has passed", () => {
    const label = formatRetryLabel(
      {
        type: "retry",
        attempt: 1,
        message: "Rate limited",
        next: NOW - 1_000,
      },
      NOW,
    );
    expect(label).toBe("Retrying... attempt 1 · Rate limited");
  });

  it("omits the reason when the message is empty", () => {
    const label = formatRetryLabel(
      { type: "retry", attempt: 3, message: "   ", next: NOW + 2_000 },
      NOW,
    );
    expect(label).toBe("Retrying... attempt 3 · 2s");
  });

  it("preserves the complete structured rate-limit error", () => {
    const reason =
      'This request would exceed your account\'s rate limit. Please try again later.: {"type":"error","error":{"type":"rate_limit_error","message":"This request would exceed your account\'s rate limit. Please try again later."},"request_id":"req_test"}';
    const label = formatRetryLabel(
      { type: "retry", attempt: 1, message: reason, next: NOW },
      NOW,
    );
    expect(label).toBe(`Retrying... attempt 1 · ${reason}`);
  });

  it("rounds the countdown up to the next whole second", () => {
    const label = formatRetryLabel(
      { type: "retry", attempt: 1, message: "Overloaded", next: NOW + 1_200 },
      NOW,
    );
    expect(label).toBe("Retrying... attempt 1 · 2s · Overloaded");
  });
});

describe("normalizeRetryReason", () => {
  it("leaves short reasons untouched", () => {
    expect(normalizeRetryReason("Provider is overloaded")).toBe(
      "Provider is overloaded",
    );
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeRetryReason("  Overloaded \n")).toBe("Overloaded");
  });

  it("keeps long reasons intact", () => {
    const reason = "y".repeat(200);
    expect(normalizeRetryReason(reason)).toBe(reason);
  });
});
