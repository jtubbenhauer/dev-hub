import { StreamingIndicator } from "@/components/chat/streaming-indicator";
import { render, screen } from "@testing-library/react";

describe("StreamingIndicator", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the retry reason reported by OpenCode", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1_000_000));

    render(
      <StreamingIndicator
        messages={[]}
        sessionStatus={{
          type: "retry",
          attempt: 2,
          message: "Provider is overloaded",
          next: 1_003_000,
        }}
      />,
    );

    expect(
      screen.getByText("Retrying... attempt 2 · 3s · Provider is overloaded"),
    ).toBeInTheDocument();
  });

  it("falls back to Thinking when there is no status or message", () => {
    render(<StreamingIndicator messages={[]} sessionStatus={null} />);
    expect(screen.getByText("Thinking...")).toBeInTheDocument();
  });
});
