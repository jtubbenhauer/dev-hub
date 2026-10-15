// @vitest-environment node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fileRoutes } from "@/packages/agent/src/routes/files";
import {
  CONTENT_SEARCH_MAX_PATTERN_LENGTH,
  parseContentSearchOutcome,
} from "@devhub/shared";

let workspaceDir: string;

function runGit(args: readonly string[]): void {
  execFileSync("git", ["-C", workspaceDir, ...args], { stdio: "ignore" });
}

beforeAll(() => {
  workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-grep-"));
  runGit(["init", "--quiet"]);
  fs.writeFileSync(path.join(workspaceDir, "alpha.txt"), "a needle here\n");
  fs.writeFileSync(path.join(workspaceDir, "beta.txt"), "needle\nneedle\n");
  fs.writeFileSync(path.join(workspaceDir, "other.txt"), "nothing to see\n");
});

afterAll(() => {
  fs.rmSync(workspaceDir, { recursive: true, force: true });
});

function getGrep(params: URLSearchParams): Promise<Response> {
  const app = fileRoutes(workspaceDir);
  return Promise.resolve(app.request(`/grep?${params.toString()}`));
}

async function readOkOutcome(response: Response) {
  const outcome = parseContentSearchOutcome(await response.json());
  if (outcome?.kind !== "ok") {
    throw new Error(`expected ok outcome, got ${JSON.stringify(outcome)}`);
  }
  return outcome;
}

describe("agent GET /files/grep", () => {
  it("returns 200 with the matching files when the pattern matches", async () => {
    const res = await getGrep(new URLSearchParams({ pattern: "needle" }));

    expect(res.status).toBe(200);
    const outcome = await readOkOutcome(res);
    expect(outcome.files.map((file) => file.path).sort()).toEqual([
      "alpha.txt",
      "beta.txt",
    ]);
  });

  it("returns 400 invalid-pattern when the regex does not compile", async () => {
    const res = await getGrep(
      new URLSearchParams({ regex: "1", pattern: "(" }),
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ kind: "invalid-pattern" });
  });

  it("returns 400 with the length message when the pattern is too long", async () => {
    const pattern = "x".repeat(CONTENT_SEARCH_MAX_PATTERN_LENGTH + 1);

    const res = await getGrep(new URLSearchParams({ pattern }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      kind: "invalid-pattern",
      message: `Search text is too long (max ${CONTENT_SEARCH_MAX_PATTERN_LENGTH} characters)`,
    });
  });

  it("returns 200 with zero results when the pattern is empty", async () => {
    const res = await getGrep(new URLSearchParams({ pattern: "" }));

    expect(res.status).toBe(200);
    const outcome = await readOkOutcome(res);
    expect(outcome.matchCount).toBe(0);
    expect(outcome.files).toEqual([]);
  });

  it("reports isLimitHit when matches exceed max", async () => {
    const res = await getGrep(
      new URLSearchParams({ pattern: "needle", max: "1" }),
    );

    expect(res.status).toBe(200);
    const outcome = await readOkOutcome(res);
    expect(outcome.isLimitHit).toBe(true);
  });
});
