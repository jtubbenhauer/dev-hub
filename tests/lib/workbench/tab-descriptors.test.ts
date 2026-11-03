import { describe, expect, it } from "vitest";
import {
  createPanelId,
  createWorkbenchTerminalSessionId,
  diffTabTitle,
  fileTabTitle,
  isWorkbenchTabParams,
  isWorkbenchTerminalSessionId,
  nextTerminalTitle,
  tabResourceKey,
  type WorkbenchTabParams,
} from "@/lib/workbench/tab-descriptors";

const WORKSPACE_ID = "ws-1";

const terminalParams: WorkbenchTabParams = {
  kind: "terminal",
  workspaceId: WORKSPACE_ID,
  sessionId: "wb-term-1234abcd",
  title: "Terminal 1",
};
const fileParams: WorkbenchTabParams = {
  kind: "file",
  workspaceId: WORKSPACE_ID,
  path: "src/app/page.tsx",
};
const chatParams: WorkbenchTabParams = {
  kind: "chat",
  workspaceId: WORKSPACE_ID,
  sessionId: "ses_abc",
};
const newChatParams: WorkbenchTabParams = {
  kind: "chat",
  workspaceId: WORKSPACE_ID,
  sessionId: null,
};
const workingDiffParams: WorkbenchTabParams = {
  kind: "diff",
  workspaceId: WORKSPACE_ID,
  path: "lib/a.ts",
  source: "working",
  baseRef: null,
};
const stagedDiffParams: WorkbenchTabParams = {
  kind: "diff",
  workspaceId: WORKSPACE_ID,
  path: "lib/a.ts",
  source: "staged",
  baseRef: null,
};
const compareDiffParams: WorkbenchTabParams = {
  kind: "diff",
  workspaceId: WORKSPACE_ID,
  path: "lib/a.ts",
  source: "compare",
  baseRef: "main",
};
const launcherParams: WorkbenchTabParams = {
  kind: "launcher",
  workspaceId: WORKSPACE_ID,
};

describe("tabResourceKey", () => {
  it("keys a terminal tab by its session id", () => {
    expect(tabResourceKey(terminalParams, "tab-1")).toBe(
      "terminal:wb-term-1234abcd",
    );
  });

  it("keys a file tab by its path", () => {
    expect(tabResourceKey(fileParams, "tab-1")).toBe("file:src/app/page.tsx");
  });

  it("keys a chat tab by its session id", () => {
    expect(tabResourceKey(chatParams, "tab-1")).toBe("chat:ses_abc");
  });

  it("keys a new chat tab by its panel id when the session is null", () => {
    expect(tabResourceKey(newChatParams, "tab-9")).toBe("chat:new:tab-9");
  });

  it("keys a working diff with an empty base ref", () => {
    expect(tabResourceKey(workingDiffParams, "tab-1")).toBe(
      "diff:working::lib/a.ts",
    );
  });

  it("keys a compare diff by source, base ref and path", () => {
    expect(tabResourceKey(compareDiffParams, "tab-1")).toBe(
      "diff:compare:main:lib/a.ts",
    );
  });

  it("keys a launcher tab by its panel id", () => {
    expect(tabResourceKey(launcherParams, "tab-7")).toBe("launcher:tab-7");
  });
});

describe("isWorkbenchTabParams", () => {
  it.each([
    ["terminal", terminalParams],
    ["file", fileParams],
    ["chat", chatParams],
    ["new chat", newChatParams],
    ["working diff", workingDiffParams],
    ["staged diff", stagedDiffParams],
    ["compare diff", compareDiffParams],
    ["launcher", launcherParams],
  ])("accepts valid %s params", (_label, params) => {
    expect(isWorkbenchTabParams(params)).toBe(true);
  });

  it("rejects a terminal tab on the drawer's default session", () => {
    expect(
      isWorkbenchTabParams({ ...terminalParams, sessionId: "default" }),
    ).toBe(false);
  });

  it("rejects an unknown kind", () => {
    expect(isWorkbenchTabParams({ kind: "x", workspaceId: WORKSPACE_ID })).toBe(
      false,
    );
  });

  it("rejects a bare unknown kind with no fields", () => {
    expect(isWorkbenchTabParams({ kind: "x" })).toBe(false);
  });

  it("rejects null", () => {
    expect(isWorkbenchTabParams(null)).toBe(false);
  });

  it.each([undefined, "file", 42, ["file"]])(
    "rejects the non-object value %j",
    (value) => {
      expect(isWorkbenchTabParams(value)).toBe(false);
    },
  );

  it("rejects a file tab without a path", () => {
    expect(isWorkbenchTabParams({ kind: "file" })).toBe(false);
  });

  it("rejects a file tab with a workspace but no path", () => {
    expect(
      isWorkbenchTabParams({ kind: "file", workspaceId: WORKSPACE_ID }),
    ).toBe(false);
  });

  it("rejects a file tab with a non-string path", () => {
    expect(isWorkbenchTabParams({ ...fileParams, path: 3 })).toBe(false);
  });

  it("rejects a diff tab with a non-string path", () => {
    expect(isWorkbenchTabParams({ ...workingDiffParams, path: null })).toBe(
      false,
    );
  });

  it("rejects a missing workspace id", () => {
    expect(isWorkbenchTabParams({ kind: "launcher" })).toBe(false);
  });

  it("rejects an empty workspace id", () => {
    expect(isWorkbenchTabParams({ ...chatParams, workspaceId: "" })).toBe(
      false,
    );
  });

  it("rejects a terminal tab without a title", () => {
    const { title: _title, ...withoutTitle } = terminalParams;
    expect(isWorkbenchTabParams(withoutTitle)).toBe(false);
  });

  it("rejects a chat tab whose session id is neither string nor null", () => {
    expect(isWorkbenchTabParams({ ...chatParams, sessionId: undefined })).toBe(
      false,
    );
  });

  it("rejects a diff tab with an unknown source", () => {
    expect(
      isWorkbenchTabParams({ ...workingDiffParams, source: "unstaged" }),
    ).toBe(false);
  });

  it("rejects a compare diff without a base ref", () => {
    expect(isWorkbenchTabParams({ ...compareDiffParams, baseRef: null })).toBe(
      false,
    );
  });
});

describe("createPanelId", () => {
  it("returns a tab- prefixed 8 hex id", () => {
    expect(createPanelId()).toMatch(/^tab-[0-9a-f]{8}$/);
  });
});

describe("createWorkbenchTerminalSessionId", () => {
  it("returns wb-term- prefixed 8 hex ids that never collide with drawer ids", () => {
    const sessionIds = Array.from({ length: 50 }, () =>
      createWorkbenchTerminalSessionId(),
    );
    for (const sessionId of sessionIds) {
      expect(sessionId).toMatch(/^wb-term-[0-9a-f]{8}$/);
      expect(sessionId).not.toBe("default");
      expect(sessionId.startsWith("term-")).toBe(false);
    }
  });
});

describe("isWorkbenchTerminalSessionId", () => {
  it("recognizes a generated workbench terminal session id", () => {
    expect(
      isWorkbenchTerminalSessionId(createWorkbenchTerminalSessionId()),
    ).toBe(true);
  });

  it.each(["default", "term-11111111", "nvim-file-editor", "wb-term"])(
    "rejects the non-workbench session id %s",
    (sessionId) => {
      expect(isWorkbenchTerminalSessionId(sessionId)).toBe(false);
    },
  );
});

describe("fileTabTitle", () => {
  it("returns the basename of a nested path", () => {
    expect(fileTabTitle("src/app/page.tsx")).toBe("page.tsx");
  });

  it("returns a top-level file name unchanged", () => {
    expect(fileTabTitle("README.md")).toBe("README.md");
  });
});

describe("diffTabTitle", () => {
  it("labels a working diff", () => {
    expect(diffTabTitle(workingDiffParams)).toBe("a.ts (working)");
  });

  it("labels a staged diff", () => {
    expect(diffTabTitle(stagedDiffParams)).toBe("a.ts (staged)");
  });

  it("labels a compare diff with its base ref", () => {
    expect(diffTabTitle(compareDiffParams)).toBe("a.ts ↔ main");
  });
});

describe("nextTerminalTitle", () => {
  it("returns Terminal 1 when there are no terminals", () => {
    expect(nextTerminalTitle([])).toBe("Terminal 1");
  });

  it("continues after the highest existing number", () => {
    expect(nextTerminalTitle(["Terminal 1", "Terminal 3"])).toBe("Terminal 4");
  });

  it("ignores titles that are not Terminal N", () => {
    expect(nextTerminalTitle(["Build", "Terminal 2 copy"])).toBe("Terminal 1");
  });
});
