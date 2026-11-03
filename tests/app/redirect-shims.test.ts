import { beforeEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({
  redirect: vi.fn<(href: string) => void>(),
}));

vi.mock("next/navigation", () => ({ redirect: navigation.redirect }));

import ChatRedirectPage from "@/app/chat/page";
import FilesRedirectPage from "@/app/files/page";
import TerminalRedirectPage from "@/app/terminal/page";

beforeEach(() => {
  navigation.redirect.mockClear();
});

describe("/chat redirect shim", () => {
  it("opens the linked chat in the workbench and drops the list view", async () => {
    // When
    await ChatRedirectPage({
      searchParams: Promise.resolve({
        workspaceId: "w1",
        sessionId: "s1",
        view: "unified",
      }),
    });

    // Then
    expect(navigation.redirect).toHaveBeenCalledExactlyOnceWith(
      "/?workspaceId=w1&open=chat&sessionId=s1",
    );
  });

  it("opens a chat in the workbench when the link names no session", async () => {
    // When
    await ChatRedirectPage({ searchParams: Promise.resolve({}) });

    // Then
    expect(navigation.redirect).toHaveBeenCalledExactlyOnceWith("/?open=chat");
  });
});

describe("/files redirect shim", () => {
  it("opens the linked file in a workbench tab", async () => {
    // When
    await FilesRedirectPage({
      searchParams: Promise.resolve({ open: "README.md" }),
    });

    // Then
    expect(navigation.redirect).toHaveBeenCalledExactlyOnceWith(
      "/?open=file&path=README.md",
    );
  });

  it("reveals the expanded folder in the workbench explorer", async () => {
    // When
    await FilesRedirectPage({
      searchParams: Promise.resolve({ expand: "src/lib" }),
    });

    // Then
    expect(navigation.redirect).toHaveBeenCalledExactlyOnceWith(
      "/?open=folder&path=src%2Flib",
    );
  });

  it("opens the workbench explorer when the link names no file", async () => {
    // When
    await FilesRedirectPage({ searchParams: Promise.resolve({}) });

    // Then
    expect(navigation.redirect).toHaveBeenCalledExactlyOnceWith(
      "/?open=explorer",
    );
  });

  it("uses the first file of a repeated open key", async () => {
    // When
    await FilesRedirectPage({
      searchParams: Promise.resolve({ open: ["a.ts", "b.ts"] }),
    });

    // Then
    expect(navigation.redirect).toHaveBeenCalledExactlyOnceWith(
      "/?open=file&path=a.ts",
    );
  });
});

describe("/terminal redirect shim", () => {
  it("opens a terminal tab for the linked workspace", async () => {
    // When
    await TerminalRedirectPage({
      searchParams: Promise.resolve({ workspace: "w9" }),
    });

    // Then
    expect(navigation.redirect).toHaveBeenCalledExactlyOnceWith(
      "/?workspaceId=w9&open=terminal",
    );
  });

  it("opens a terminal tab in the active workspace when the link names none", async () => {
    // When
    await TerminalRedirectPage({ searchParams: Promise.resolve({}) });

    // Then
    expect(navigation.redirect).toHaveBeenCalledExactlyOnceWith(
      "/?open=terminal",
    );
  });
});
