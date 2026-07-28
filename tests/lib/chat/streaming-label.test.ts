import {
  formatRetryLabel,
  truncateRetryReason,
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

  it("truncates a long reason", () => {
    const label = formatRetryLabel(
      { type: "retry", attempt: 1, message: "x".repeat(120), next: NOW },
      NOW,
    );
    expect(label).toBe(`Retrying... attempt 1 · ${"x".repeat(80)}...`);
  });

  it("rounds the countdown up to the next whole second", () => {
    const label = formatRetryLabel(
      { type: "retry", attempt: 1, message: "Overloaded", next: NOW + 1_200 },
      NOW,
    );
    expect(label).toBe("Retrying... attempt 1 · 2s · Overloaded");
  });
});

describe("truncateRetryReason", () => {
  it("leaves short reasons untouched", () => {
    expect(truncateRetryReason("Provider is overloaded")).toBe(
      "Provider is overloaded",
    );
  });

  it("trims surrounding whitespace", () => {
    expect(truncateRetryReason("  Overloaded \n")).toBe("Overloaded");
  });

  it("keeps a reason of exactly the max length intact", () => {
    const reason = "y".repeat(80);
    expect(truncateRetryReason(reason)).toBe(reason);
  });
});
