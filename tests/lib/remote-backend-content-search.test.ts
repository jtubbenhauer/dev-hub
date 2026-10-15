// @vitest-environment node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { parseContentSearchParams } from "@devhub/shared";
import type { ContentSearchOutcome, ContentSearchQuery } from "@devhub/shared";
import { LocalBackend, RemoteBackend } from "@/lib/workspaces/backend";

const query: ContentSearchQuery = {
  pattern: "needle(",
  isRegex: true,
  isCaseSensitive: true,
  isWholeWord: false,
  includeGlobs: ["src/**", "*.ts"],
  excludeGlobs: ["dist/**"],
  maxResults: 500,
};

const okOutcome: ContentSearchOutcome = {
  kind: "ok",
  files: [
    {
      path: "src/a.ts",
      matches: [
        {
          lineNumber: 3,
          startColumn: 7,
          endColumn: 13,
          startByteColumn: 7,
          matchFingerprint: "fp-needle",
          lineSha256: "0".repeat(64),
          preview: "const needle = 1;",
          previewMatchStart: 6,
          previewMatchEnd: 12,
        },
      ],
    },
  ],
  matchCount: 1,
  fileCount: 1,
  isLimitHit: false,
  isTimedOut: false,
  engine: "ripgrep",
  durationMs: 12,
};

const fetchMock = vi.fn<typeof globalThis.fetch>();

function makeRemoteBackend() {
  return new RemoteBackend("http://agent.test:7500", "http://opencode.test");
}

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("RemoteBackend.searchContent", () => {
  beforeAll(() => vi.stubGlobal("fetch", fetchMock));
  afterEach(() => fetchMock.mockReset());
  afterAll(() => vi.unstubAllGlobals());

  it("requests /files/grep with the encoded query and passes the signal through", async () => {
    fetchMock.mockResolvedValue(jsonResponse(okOutcome, 200));
    const controller = new AbortController();

    await makeRemoteBackend().searchContent(query, controller.signal);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [requestUrl, init] = fetchMock.mock.calls[0] ?? [];
    const url = new URL(String(requestUrl));
    expect(url.origin).toBe("http://agent.test:7500");
    expect(url.pathname).toBe("/files/grep");
    expect(parseContentSearchParams(url.searchParams)).toEqual({
      kind: "ok",
      query,
    });
    expect(init?.signal).toBe(controller.signal);
  });

  it("passes a 200 ok outcome through unchanged", async () => {
    fetchMock.mockResolvedValue(jsonResponse(okOutcome, 200));

    const outcome = await makeRemoteBackend().searchContent(query);

    expect(outcome).toEqual(okOutcome);
  });

  it("passes a 400 invalid-pattern outcome through", async () => {
    const invalidOutcome = {
      kind: "invalid-pattern",
      message: "regex parse error: unclosed group",
    };
    fetchMock.mockResolvedValue(jsonResponse(invalidOutcome, 400));

    const outcome = await makeRemoteBackend().searchContent(query);

    expect(outcome).toEqual(invalidOutcome);
  });

  it("maps a 404 to unavailable with an update hint", async () => {
    fetchMock.mockResolvedValue(new Response("404 Not Found", { status: 404 }));

    const outcome = await makeRemoteBackend().searchContent(query);

    expect(outcome).toEqual({
      kind: "unavailable",
      message:
        "The remote agent does not support content search yet - update it",
    });
  });

  it("maps a non-JSON (HTML) 502 body to failed with the status", async () => {
    fetchMock.mockResolvedValue(
      new Response("<html><body>Bad Gateway</body></html>", {
        status: 502,
        headers: { "Content-Type": "text/html" },
      }),
    );

    const outcome = await makeRemoteBackend().searchContent(query);

    expect(outcome).toEqual({
      kind: "failed",
      message: "Agent request failed: 502",
    });
  });

  it("maps a JSON body that is not an outcome to failed with the status", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ kind: "ok", files: "not-an-array" }, 200),
    );

    const outcome = await makeRemoteBackend().searchContent(query);

    expect(outcome).toEqual({
      kind: "failed",
      message: "Agent request failed: 200",
    });
  });

  it("maps a network error to failed with the error message", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));

    const outcome = await makeRemoteBackend().searchContent(query);

    expect(outcome).toEqual({
      kind: "failed",
      message: "Could not reach the remote agent: fetch failed",
    });
  });

  it("maps an AbortError to failed Search cancelled", async () => {
    fetchMock.mockRejectedValue(
      new DOMException("This operation was aborted", "AbortError"),
    );

    const outcome = await makeRemoteBackend().searchContent(query);

    expect(outcome).toEqual({ kind: "failed", message: "Search cancelled" });
  });
});

describe("LocalBackend.searchContent", () => {
  const scratch = "/tmp/omo-scratch/find-in-files/task-7";
  let workspacePath: string;

  beforeAll(() => {
    fs.mkdirSync(scratch, { recursive: true });
    workspacePath = fs.mkdtempSync(path.join(scratch, "local-"));
    fs.mkdirSync(path.join(workspacePath, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(workspacePath, "src/a.ts"),
      "const needle = 1;\n",
    );
    fs.writeFileSync(path.join(workspacePath, "src/b.ts"), "const hay = 2;\n");
    execFileSync("git", ["init", "-q"], { cwd: workspacePath });
    execFileSync("git", ["add", "."], { cwd: workspacePath });
  });
  afterAll(() => fs.rmSync(workspacePath, { recursive: true, force: true }));

  it("searches the workspace folder and returns the matching file", async () => {
    const outcome = await new LocalBackend(workspacePath).searchContent({
      ...query,
      pattern: "needle",
      isRegex: false,
      includeGlobs: [],
      excludeGlobs: [],
    });

    expect(outcome.kind).toBe("ok");
    const matchedPaths =
      outcome.kind === "ok" ? outcome.files.map((file) => file.path) : [];
    expect(matchedPaths).toEqual(["src/a.ts"]);
  });
});
