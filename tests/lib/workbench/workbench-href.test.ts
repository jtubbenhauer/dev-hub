import { describe, expect, it } from "vitest";

import {
  WORKBENCH_PATH,
  createWorkbenchHref,
  legacyChatSearchToHref,
  legacyFilesSearchToHref,
  legacyTerminalSearchToHref,
  parseWorkbenchIntent,
  toUrlSearchParams,
  type WorkbenchIntent,
} from "@/lib/workbench/workbench-href";

function searchParamsOf(href: string): URLSearchParams {
  return new URL(href, "http://localhost").searchParams;
}

function pathnameOf(href: string): string {
  return new URL(href, "http://localhost").pathname;
}

function intentOf(href: string): WorkbenchIntent | null {
  return parseWorkbenchIntent(searchParamsOf(href));
}

describe("WORKBENCH_PATH", () => {
  it("is the landing page", () => {
    expect(WORKBENCH_PATH).toBe("/");
  });
});

describe("createWorkbenchHref", () => {
  it("returns the bare workbench path when the intent is null", () => {
    expect(createWorkbenchHref(null)).toBe(WORKBENCH_PATH);
  });

  it("orders query keys workspaceId, open, sessionId", () => {
    const href = createWorkbenchHref({
      open: "chat",
      workspaceId: "w1",
      sessionId: "s1",
    });

    expect(href).toBe(
      `${WORKBENCH_PATH}?workspaceId=w1&open=chat&sessionId=s1`,
    );
  });

  it("orders query keys workspaceId, open, path and encodes the path", () => {
    const href = createWorkbenchHref({
      open: "file",
      workspaceId: "w1",
      path: "src/a b.ts",
    });

    expect(href).toBe(
      `${WORKBENCH_PATH}?workspaceId=w1&open=file&path=src%2Fa+b.ts`,
    );
  });

  it("omits null workspace and session values", () => {
    const href = createWorkbenchHref({
      open: "chat",
      workspaceId: null,
      sessionId: null,
    });

    expect(href).toBe(`${WORKBENCH_PATH}?open=chat`);
  });

  it("omits empty-string workspace and session values", () => {
    const href = createWorkbenchHref({
      open: "chat",
      workspaceId: "",
      sessionId: "",
    });

    expect(href).toBe(`${WORKBENCH_PATH}?open=chat`);
  });

  it("targets the workbench pathname", () => {
    const href = createWorkbenchHref({ open: "terminal", workspaceId: "w1" });

    expect(pathnameOf(href)).toBe(WORKBENCH_PATH);
  });
});

describe("parseWorkbenchIntent round-trip", () => {
  const intents: readonly WorkbenchIntent[] = [
    { open: "chat", workspaceId: "w1", sessionId: "s1" },
    { open: "chat", workspaceId: null, sessionId: null },
    { open: "file", workspaceId: "w1", path: "src/index.ts" },
    { open: "file", workspaceId: null, path: "README.md" },
    { open: "folder", workspaceId: "w1", path: "src/lib" },
    { open: "explorer", workspaceId: "w1" },
    { open: "search", workspaceId: null },
    { open: "terminal", workspaceId: "w3" },
    { open: "new-chat", workspaceId: "w2" },
  ];

  it.each(intents)("round-trips %o", (intent) => {
    expect(intentOf(createWorkbenchHref(intent))).toEqual(intent);
  });
});

describe("parseWorkbenchIntent", () => {
  it("parses a new-chat intent without a session", () => {
    const intent = parseWorkbenchIntent(
      new URLSearchParams("open=new-chat&workspaceId=w2"),
    );

    expect(intent).toEqual({ open: "new-chat", workspaceId: "w2" });
  });

  it("drops a sessionId on a new-chat intent", () => {
    const intent = parseWorkbenchIntent(
      new URLSearchParams("open=new-chat&workspaceId=w2&sessionId=s1"),
    );

    expect(intent).toEqual({ open: "new-chat", workspaceId: "w2" });
  });

  it("returns null for a file intent without a path", () => {
    expect(parseWorkbenchIntent(new URLSearchParams("open=file"))).toBeNull();
  });

  it("returns null for a file intent with an empty path", () => {
    expect(
      parseWorkbenchIntent(new URLSearchParams("open=file&path=")),
    ).toBeNull();
  });

  it("returns null for a folder intent without a path", () => {
    expect(
      parseWorkbenchIntent(new URLSearchParams("open=folder&workspaceId=w1")),
    ).toBeNull();
  });

  it("returns null when open is missing", () => {
    expect(
      parseWorkbenchIntent(new URLSearchParams("workspaceId=w1&sessionId=s1")),
    ).toBeNull();
  });

  it("returns null when open is unknown", () => {
    expect(
      parseWorkbenchIntent(new URLSearchParams("open=dashboard")),
    ).toBeNull();
  });

  it("returns null for empty params", () => {
    expect(parseWorkbenchIntent(new URLSearchParams())).toBeNull();
  });

  it("treats an empty workspaceId as null", () => {
    const intent = parseWorkbenchIntent(
      new URLSearchParams("open=terminal&workspaceId="),
    );

    expect(intent).toEqual({ open: "terminal", workspaceId: null });
  });
});

describe("legacyChatSearchToHref", () => {
  it("keeps workspace and session and drops view, group and age", () => {
    const href = legacyChatSearchToHref(
      new URLSearchParams(
        "workspaceId=w1&sessionId=s1&view=unified&group=1&age=1d",
      ),
    );

    expect(href).toBe(
      createWorkbenchHref({ open: "chat", workspaceId: "w1", sessionId: "s1" }),
    );
  });

  it("maps an empty chat query to a chat intent with no workspace", () => {
    const href = legacyChatSearchToHref(new URLSearchParams());

    expect(intentOf(href)).toEqual({
      open: "chat",
      workspaceId: null,
      sessionId: null,
    });
  });
});

describe("legacyFilesSearchToHref", () => {
  it("maps open=<path> to a file intent", () => {
    const href = legacyFilesSearchToHref(
      new URLSearchParams("open=src/index.ts"),
    );

    expect(intentOf(href)).toEqual({
      open: "file",
      workspaceId: null,
      path: "src/index.ts",
    });
  });

  it("maps expand=<path> to a folder intent", () => {
    const href = legacyFilesSearchToHref(new URLSearchParams("expand=src/lib"));

    expect(intentOf(href)).toEqual({
      open: "folder",
      workspaceId: null,
      path: "src/lib",
    });
  });

  it("prefers open over expand when both are present", () => {
    const href = legacyFilesSearchToHref(
      new URLSearchParams("open=a.ts&expand=src"),
    );

    expect(intentOf(href)).toEqual({
      open: "file",
      workspaceId: null,
      path: "a.ts",
    });
  });

  it("maps an empty files query to an explorer intent", () => {
    const href = legacyFilesSearchToHref(new URLSearchParams());

    expect(intentOf(href)).toEqual({ open: "explorer", workspaceId: null });
  });

  it("maps empty open and expand values to an explorer intent", () => {
    const href = legacyFilesSearchToHref(new URLSearchParams("open=&expand="));

    expect(intentOf(href)).toEqual({ open: "explorer", workspaceId: null });
  });
});

describe("legacyTerminalSearchToHref", () => {
  it("maps workspace=<id> to a terminal intent for that workspace", () => {
    const href = legacyTerminalSearchToHref(
      new URLSearchParams("workspace=w9"),
    );

    expect(intentOf(href)).toEqual({ open: "terminal", workspaceId: "w9" });
  });

  it("maps an empty terminal query to a terminal intent with no workspace", () => {
    const href = legacyTerminalSearchToHref(new URLSearchParams());

    expect(intentOf(href)).toEqual({ open: "terminal", workspaceId: null });
  });
});

describe("toUrlSearchParams", () => {
  it("copies string values", () => {
    const params = toUrlSearchParams({ workspace: "w9", open: "a b.ts" });

    expect(params.toString()).toBe("workspace=w9&open=a+b.ts");
  });

  it("takes the first value of a repeated key", () => {
    const params = toUrlSearchParams({ open: ["README.md", "b.ts"] });

    expect(params.getAll("open")).toEqual(["README.md"]);
  });

  it("skips undefined values and empty arrays", () => {
    const params = toUrlSearchParams({ open: undefined, expand: [] });

    expect(params.toString()).toBe("");
  });

  it("keeps empty strings so the legacy parsers can treat them as absent", () => {
    const params = toUrlSearchParams({ workspace: "" });

    expect(params.has("workspace")).toBe(true);
  });
});
