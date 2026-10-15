// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ContentSearchOutcome } from "@devhub/shared";
import { searchWorkspaceContent } from "@devhub/shared/content-search";
import { fileRoutes } from "@/packages/agent/src/routes/files";

vi.mock("@devhub/shared/content-search", () => ({
  searchWorkspaceContent: vi.fn(),
}));

const OK_OUTCOME: ContentSearchOutcome = {
  kind: "ok",
  files: [],
  matchCount: 0,
  fileCount: 0,
  isLimitHit: false,
  isTimedOut: false,
  engine: "git-grep",
  durationMs: 1,
};

const OUTCOME_STATUS_CASES: ReadonlyArray<{
  readonly outcome: ContentSearchOutcome;
  readonly expectedStatus: number;
}> = [
  { outcome: OK_OUTCOME, expectedStatus: 200 },
  {
    outcome: { kind: "invalid-pattern", message: "bad regex" },
    expectedStatus: 400,
  },
  {
    outcome: { kind: "unavailable", message: "install ripgrep" },
    expectedStatus: 503,
  },
  { outcome: { kind: "failed", message: "boom" }, expectedStatus: 500 },
];

beforeEach(() => {
  vi.mocked(searchWorkspaceContent).mockReset();
});

describe("agent GET /files/grep status mapping", () => {
  it.each(OUTCOME_STATUS_CASES)(
    "returns $expectedStatus when the search outcome is $outcome.kind",
    async ({ outcome, expectedStatus }) => {
      vi.mocked(searchWorkspaceContent).mockResolvedValue(outcome);

      const res = await fileRoutes("/workspace").request(
        "/grep?pattern=needle",
      );

      expect(res.status).toBe(expectedStatus);
      expect(await res.json()).toEqual(outcome);
    },
  );

  it("passes the workspace path, parsed query and request signal", async () => {
    vi.mocked(searchWorkspaceContent).mockResolvedValue(OK_OUTCOME);

    await fileRoutes("/workspace").request(
      "/grep?pattern=needle&regex=1&max=7",
    );

    expect(searchWorkspaceContent).toHaveBeenCalledWith({
      workspacePath: "/workspace",
      query: expect.objectContaining({
        pattern: "needle",
        isRegex: true,
        maxResults: 7,
      }),
      signal: expect.any(AbortSignal),
    });
  });

  it("does not search when the params are invalid", async () => {
    await fileRoutes("/workspace").request("/grep?pattern=a%0Ab");

    expect(searchWorkspaceContent).not.toHaveBeenCalled();
  });
});
