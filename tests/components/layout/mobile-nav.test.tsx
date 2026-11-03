import { render, screen } from "@testing-library/react";
import type { AnchorHTMLAttributes } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MobileNav } from "@/components/layout/mobile-nav";

const navigation = vi.hoisted(() => ({ pathname: "/" }));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
}));
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/hooks/use-keyboard-visible", () => ({
  useKeyboardVisible: () => false,
}));

function activeLinkLabels(): string[] {
  return screen
    .getAllByRole("link")
    .filter((link) => link.classList.contains("text-primary"))
    .map((link) => link.textContent ?? "");
}

beforeEach(() => {
  navigation.pathname = "/";
});

describe("MobileNav", () => {
  it("renders the Work, Dash, Git, PRs, Tasks, Repos and Settings links in order", () => {
    // When
    render(<MobileNav />);

    // Then
    const links = screen.getAllByRole("link").map((link) => ({
      label: link.textContent,
      href: link.getAttribute("href"),
    }));
    expect(links).toEqual([
      { label: "Work", href: "/" },
      { label: "Dash", href: "/dashboard" },
      { label: "Git", href: "/git" },
      { label: "PRs", href: "/prs" },
      { label: "Tasks", href: "/tasks" },
      { label: "Repos", href: "/workspaces" },
      { label: "Settings", href: "/settings" },
    ]);
  });

  it.each([
    { pathname: "/", activeLabel: "Work" },
    { pathname: "/dashboard", activeLabel: "Dash" },
    { pathname: "/settings/keybindings", activeLabel: "Settings" },
  ])(
    "highlights only $activeLabel when pathname is $pathname",
    ({ pathname, activeLabel }) => {
      // Given
      navigation.pathname = pathname;

      // When
      render(<MobileNav />);

      // Then
      expect(activeLinkLabels()).toEqual([activeLabel]);
    },
  );
});
