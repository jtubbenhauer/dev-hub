// @vitest-environment node

import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const verifierPath = join(
  process.cwd(),
  "scripts",
  "verify-omo-prohibitions.mjs",
);
const tempDirectories: string[] = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createTempTree(): string {
  const directory = mkdtempSync(join(tmpdir(), "omo-prohibitions-"));
  tempDirectories.push(directory);
  return directory;
}

function writeFixture(
  root: string,
  relativePath: string,
  content: string,
): string {
  const filePath = join(root, relativePath);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content);
  return filePath;
}

function runVerifier(root: string) {
  return spawnSync(process.execPath, [verifierPath, "--root", root], {
    encoding: "utf8",
  });
}

function combinedOutput(result: ReturnType<typeof runVerifier>): string {
  return `${result.stdout}${result.stderr}`;
}

describe("OmO prohibition verifier", () => {
  it("reports zero violations for a clean tree", () => {
    const root = createTempTree();
    writeFixture(root, "lib/clean.ts", 'export const value = "safe";\n');

    const result = runVerifier(root);

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("OK: 0 violations");
  });

  it("names the file containing a forbidden daemon stop command", () => {
    const root = createTempTree();
    writeFixture(
      root,
      "app/commands.ts",
      'const command = ["daemon", "stop"];\n',
    );

    const result = runVerifier(root);

    expect(result.status).toBe(1);
    expect(combinedOutput(result)).toContain("app/commands.ts");
  });

  it("rejects omo-ai in package dependencies", () => {
    const root = createTempTree();
    writeFixture(
      root,
      "package.json",
      JSON.stringify({ dependencies: { "omo-ai": "1.0.0" } }),
    );

    const result = runVerifier(root);

    expect(result.status).toBe(1);
    expect(combinedOutput(result)).toContain("package.json");
    expect(combinedOutput(result)).toContain("omo-ai");
  });

  it("rejects secret-file access under lib/omo", () => {
    const root = createTempTree();
    writeFixture(
      root,
      "lib/omo/x.ts",
      'const secretPath = agentPath + ".secret";\n',
    );

    const result = runVerifier(root);

    expect(result.status).toBe(1);
    expect(combinedOutput(result)).toContain("lib/omo/x.ts");
  });

  it("skips a verifier copy by basename", () => {
    const root = createTempTree();
    const copiedVerifierPath = join(
      root,
      "scripts",
      "verify-omo-prohibitions.mjs",
    );
    mkdirSync(dirname(copiedVerifierPath), { recursive: true });
    copyFileSync(verifierPath, copiedVerifierPath);

    const result = runVerifier(root);

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("OK: 0 violations");
  });
});
