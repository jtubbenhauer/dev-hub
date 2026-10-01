import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CommandPicker } from "@/components/chat/command-picker";

describe("CommandPicker", () => {
  it("offers /export as a built-in even when the server does not list it", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <CommandPicker
        commands={[]}
        query="exp"
        onSelect={onSelect}
        onClose={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: /\/export/ }));

    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ name: "export", source: "builtin" }),
    );
  });
});
