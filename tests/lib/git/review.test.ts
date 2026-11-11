// @vitest-environment node
import fs from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { getChangedFiles } from "@/lib/git/review";
import { createFeatureBranchRepo } from "@/tests/helpers/feature-branch-repo";

const createdDirs: string[] = [];

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

async function featureBranchRepo(): Promise<string> {
  const dir = await createFeatureBranchRepo();
  createdDirs.push(dir);
  return dir;
}

describe("getChangedFiles", () => {
  it("lists only committed changes when given a currentRef", async () => {
    // Given
    const dir = await featureBranchRepo();

    // When
    const files = await getChangedFiles(dir, "main", "HEAD");

    // Then
    expect(files).toEqual([
      {
        path: "feature.txt",
        status: "added",
        additions: 1,
        deletions: 0,
        isBinary: false,
      },
      {
        path: "shared.txt",
        status: "modified",
        additions: 1,
        deletions: 0,
        isBinary: false,
      },
    ]);
  });

  it("includes uncommitted changes without a currentRef", async () => {
    // Given
    const dir = await featureBranchRepo();

    // When
    const files = await getChangedFiles(dir, "main");

    // Then
    expect(files.map((file) => file.path)).toEqual([
      "feature.txt",
      "shared.txt",
      "staged.txt",
      "untouched.txt",
    ]);
  });
});
