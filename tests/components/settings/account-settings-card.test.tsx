import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AccountSettingsCard } from "@/components/settings/account-settings-card";

const auth = vi.hoisted(() => ({ signOut: vi.fn() }));

vi.mock("next-auth/react", () => ({ signOut: auth.signOut }));

describe("AccountSettingsCard", () => {
  it("signs out to the login page when Log out is clicked", async () => {
    // Given
    render(<AccountSettingsCard />);

    // When
    await userEvent.click(screen.getByRole("button", { name: "Log out" }));

    // Then
    expect(auth.signOut).toHaveBeenCalledWith({ callbackUrl: "/login" });
  });
});
