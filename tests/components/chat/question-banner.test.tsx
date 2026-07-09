import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { QuestionBanner } from "@/components/chat/question-banner";
import type { QuestionRequest } from "@/lib/opencode/types";

function makeRequest(count: number): QuestionRequest {
  return {
    id: "q-1",
    sessionID: "sess-1",
    questions: Array.from({ length: count }, (_, i) => ({
      question: `Question ${i + 1}?`,
      header: `Q${i + 1}`,
      options: [
        { label: `Yes-${i + 1}`, description: "" },
        { label: `No-${i + 1}`, description: "" },
      ],
      multiple: false,
      custom: true,
    })),
  } as QuestionRequest;
}

afterEach(() => {
  cleanup();
});

describe("QuestionBanner - Reply gating", () => {
  it("disables Reply when no questions are answered", () => {
    render(
      <QuestionBanner
        request={makeRequest(2)}
        onReply={vi.fn()}
        onReject={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: /reply/i })).toBeDisabled();
  });

  it("keeps Reply disabled when only some questions are answered", async () => {
    const user = userEvent.setup();
    render(
      <QuestionBanner
        request={makeRequest(2)}
        onReply={vi.fn()}
        onReject={vi.fn()}
      />,
    );

    // Answer only the first question.
    await user.click(screen.getByRole("button", { name: "Yes-1" }));

    expect(screen.getByRole("button", { name: /reply/i })).toBeDisabled();
  });

  it("enables Reply only after every question has an answer", async () => {
    const user = userEvent.setup();
    render(
      <QuestionBanner
        request={makeRequest(2)}
        onReply={vi.fn()}
        onReject={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Yes-1" }));
    expect(screen.getByRole("button", { name: /reply/i })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "No-2" }));
    expect(screen.getByRole("button", { name: /reply/i })).toBeEnabled();
  });

  it("accepts a custom text input as a valid answer for a question", async () => {
    const user = userEvent.setup();
    const onReply = vi.fn();
    render(
      <QuestionBanner
        request={makeRequest(2)}
        onReply={onReply}
        onReject={vi.fn()}
      />,
    );

    const [firstInput, secondInput] =
      screen.getAllByPlaceholderText(/custom answer/i);

    // Fill the first question with custom text; leave the second empty.
    await user.type(firstInput, "custom-answer");
    expect(screen.getByRole("button", { name: /reply/i })).toBeDisabled();

    // Answer the second — now Reply should be enabled.
    await user.type(secondInput, "another-answer");
    const reply = screen.getByRole("button", { name: /reply/i });
    expect(reply).toBeEnabled();

    await user.click(reply);
    expect(onReply).toHaveBeenCalledTimes(1);
    expect(onReply).toHaveBeenCalledWith([
      ["custom-answer"],
      ["another-answer"],
    ]);
  });

  it("passes the collected answers to onReply when all questions are answered", async () => {
    const user = userEvent.setup();
    const onReply = vi.fn();
    render(
      <QuestionBanner
        request={makeRequest(2)}
        onReply={onReply}
        onReject={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Yes-1" }));
    await user.click(screen.getByRole("button", { name: "No-2" }));
    await user.click(screen.getByRole("button", { name: /reply/i }));

    expect(onReply).toHaveBeenCalledTimes(1);
    expect(onReply).toHaveBeenCalledWith([["Yes-1"], ["No-2"]]);
  });

  it("does not submit on Enter in custom input while questions remain unanswered", async () => {
    const user = userEvent.setup();
    const onReply = vi.fn();
    render(
      <QuestionBanner
        request={makeRequest(2)}
        onReply={onReply}
        onReject={vi.fn()}
      />,
    );

    const [firstInput] = screen.getAllByPlaceholderText(/custom answer/i);
    await user.type(firstInput, "partial{Enter}");

    expect(onReply).not.toHaveBeenCalled();
  });

  it("does not submit on Shift+Enter — allows inserting a newline", async () => {
    const user = userEvent.setup();
    const onReply = vi.fn();
    render(
      <QuestionBanner
        request={makeRequest(1)}
        onReply={onReply}
        onReject={vi.fn()}
      />,
    );

    const input = screen.getByPlaceholderText(/custom answer/i);
    await user.click(input);
    await user.keyboard("first{Shift>}{Enter}{/Shift}second");

    expect(onReply).not.toHaveBeenCalled();
  });

  it("preserves newlines in the submitted custom answer", async () => {
    const user = userEvent.setup();
    const onReply = vi.fn();
    render(
      <QuestionBanner
        request={makeRequest(1)}
        onReply={onReply}
        onReject={vi.fn()}
      />,
    );

    const input = screen.getByPlaceholderText(
      /custom answer/i,
    ) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "line1\nline2" } });

    await user.click(screen.getByRole("button", { name: /reply/i }));

    expect(onReply).toHaveBeenCalledTimes(1);
    expect(onReply).toHaveBeenCalledWith([["line1\nline2"]]);
  });

  it("renders the custom answer as a textarea (supports multi-line input)", () => {
    render(
      <QuestionBanner
        request={makeRequest(1)}
        onReply={vi.fn()}
        onReject={vi.fn()}
      />,
    );

    const input = screen.getByPlaceholderText(/custom answer/i);
    expect(input.tagName).toBe("TEXTAREA");
  });
});
