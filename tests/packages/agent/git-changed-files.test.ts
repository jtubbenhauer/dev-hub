// @vitest-environment node
import fs from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { gitRoutes } from "@/packages/agent/src/routes/git";
import { createFeatureBranchRepo } from "@/tests/helpers/feature-branch-repo";

const createdDirs: string[] = [];

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

async function getChangedPaths(query: string): Promise<string[]> {
  const dir = await createFeatureBranchRepo();
  createdDirs.push(dir);
  const res = await gitRoutes(dir).request(`/changed-files?${query}`);
  expect(res.status).toBe(200);
  const files: { path: string }[] = await res.json();
  return files.map((file) => file.path);
}

describe("agent GET /git/changed-files", () => {
  it("lists only committed changes when given a currentRef", async () => {
    const paths = await getChangedPaths("baseRef=main&currentRef=HEAD");

    expect(paths).toEqual(["feature.txt", "shared.txt"]);
  });

  it("includes uncommitted changes without a currentRef", async () => {
    const paths = await getChangedPaths("baseRef=main");

    expect(paths).toEqual([
      "feature.txt",
      "shared.txt",
      "staged.txt",
      "untouched.txt",
    ]);
  });
});
