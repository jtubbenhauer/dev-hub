// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock fs/promises and db before importing the module under test
vi.mock("node:fs/promises", () => ({
  default: {
    readFile: vi.fn(),
  },
}));

// Mock the db module — getSuggestions and getRecentHistory/getHistoryFrequency use it
vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          groupBy: vi.fn(() => ({
            orderBy: vi.fn(() => ({
              limit: vi.fn(() => []),
            })),
          })),
          limit: vi.fn(() => []),
        })),
      })),
    })),
  },
}));

vi.mock("@/drizzle/schema", () => ({
  commandHistory: {
    command: "command",
    workspaceId: "workspaceId",
  },
  settings: {
    userId: "userId",
    key: "key",
    value: "value",
  },
}));

import fs from "node:fs/promises";

// We need to dynamically import the module after mocks are set up
// The parsers are not exported, so we test them through getSuggestions
// However, we can test the parsing logic indirectly by setting up filesystem mocks

describe("autocomplete parsers (via getSuggestions)", () => {
  const mockReadFile = vi.mocked(fs.readFile);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("parsePackageScripts (via getSuggestions)", () => {
    it("extracts npm run commands from package.json scripts", async () => {
      const { getSuggestions } = await import("@/lib/commands/autocomplete");

      mockReadFile.mockImplementation(async (filePath) => {
        const pathStr =
          typeof filePath === "string" ? filePath : filePath.toString();
        if (pathStr.endsWith("package.json")) {
          return JSON.stringify({
            scripts: {
              dev: "next dev",
              build: "next build",
              test: "vitest run",
            },
          });
        }
        throw new Error("ENOENT");
      });

      const results = await getSuggestions("ws-1", "/workspace", "");

      const scriptSuggestions = results.filter((s) => s.source === "script");
      expect(scriptSuggestions.length).toBe(3);

      const values = scriptSuggestions.map((s) => s.value);
      expect(values).toContain("npm run dev");
      expect(values).toContain("npm run build");
      expect(values).toContain("npm run test");
    });

    it("returns empty when package.json has no scripts", async () => {
      const { getSuggestions } = await import("@/lib/commands/autocomplete");

      mockReadFile.mockImplementation(async (filePath) => {
        const pathStr =
          typeof filePath === "string" ? filePath : filePath.toString();
        if (pathStr.endsWith("package.json")) {
          return JSON.stringify({ name: "test-pkg" });
        }
        throw new Error("ENOENT");
      });

      const results = await getSuggestions("ws-1", "/workspace", "");
      const scriptSuggestions = results.filter((s) => s.source === "script");
      expect(scriptSuggestions).toHaveLength(0);
    });

    it("returns empty when package.json is invalid JSON", async () => {
      const { getSuggestions } = await import("@/lib/commands/autocomplete");

      mockReadFile.mockImplementation(async (filePath) => {
        const pathStr =
          typeof filePath === "string" ? filePath : filePath.toString();
        if (pathStr.endsWith("package.json")) {
          return "not valid json {";
        }
        throw new Error("ENOENT");
      });

      const results = await getSuggestions("ws-1", "/workspace", "");
      const scriptSuggestions = results.filter((s) => s.source === "script");
      expect(scriptSuggestions).toHaveLength(0);
    });
  });

  describe("parseMakeTargets (via getSuggestions)", () => {
    it("extracts make targets from Makefile", async () => {
      const { getSuggestions } = await import("@/lib/commands/autocomplete");

      mockReadFile.mockImplementation(async (filePath) => {
        const pathStr =
          typeof filePath === "string" ? filePath : filePath.toString();
        if (pathStr.endsWith("Makefile")) {
          return [
            "build:",
            "\tgo build ./...",
            "",
            "test:",
            "\tgo test ./...",
            "",
            "clean:",
            "\trm -rf bin/",
          ].join("\n");
        }
        throw new Error("ENOENT");
      });

      const results = await getSuggestions("ws-1", "/workspace", "");
      const makeTargets = results.filter((s) => s.source === "make");

      expect(makeTargets.length).toBe(3);
      expect(makeTargets.map((s) => s.value)).toContain("make build");
      expect(makeTargets.map((s) => s.value)).toContain("make test");
      expect(makeTargets.map((s) => s.value)).toContain("make clean");
    });

    it("excludes dot-prefixed targets", async () => {
      const { getSuggestions } = await import("@/lib/commands/autocomplete");

      mockReadFile.mockImplementation(async (filePath) => {
        const pathStr =
          typeof filePath === "string" ? filePath : filePath.toString();
        if (pathStr.endsWith("Makefile")) {
          return ".PHONY: build\nbuild:\n\techo build";
        }
        throw new Error("ENOENT");
      });

      const results = await getSuggestions("ws-1", "/workspace", "");
      const makeTargets = results.filter((s) => s.source === "make");

      const values = makeTargets.map((s) => s.value);
      expect(values).not.toContain("make .PHONY");
      expect(values).toContain("make build");
    });
  });

  describe("parseCargoTargets (via getSuggestions)", () => {
    it("returns standard cargo commands when Cargo.toml exists", async () => {
      const { getSuggestions } = await import("@/lib/commands/autocomplete");

      mockReadFile.mockImplementation(async (filePath) => {
        const pathStr =
          typeof filePath === "string" ? filePath : filePath.toString();
        if (pathStr.endsWith("Cargo.toml")) {
          return '[package]\nname = "myproject"\nversion = "0.1.0"';
        }
        throw new Error("ENOENT");
      });

      const results = await getSuggestions("ws-1", "/workspace", "");
      const cargoSuggestions = results.filter((s) => s.source === "cargo");

      expect(cargoSuggestions.length).toBeGreaterThanOrEqual(6);
      const values = cargoSuggestions.map((s) => s.value);
      expect(values).toContain("cargo build");
      expect(values).toContain("cargo test");
      expect(values).toContain("cargo run");
      expect(values).toContain("cargo check");
      expect(values).toContain("cargo clippy");
      expect(values).toContain("cargo fmt");
    });

    it("returns no cargo suggestions when Cargo.toml does not exist", async () => {
      const { getSuggestions } = await import("@/lib/commands/autocomplete");

      mockReadFile.mockRejectedValue(new Error("ENOENT"));

      const results = await getSuggestions("ws-1", "/workspace", "");
      const cargoSuggestions = results.filter((s) => s.source === "cargo");
      expect(cargoSuggestions).toHaveLength(0);
    });
  });

  describe("query filtering", () => {
    it("filters suggestions by query (case-insensitive)", async () => {
      const { getSuggestions } = await import("@/lib/commands/autocomplete");

      mockReadFile.mockImplementation(async (filePath) => {
        const pathStr =
          typeof filePath === "string" ? filePath : filePath.toString();
        if (pathStr.endsWith("package.json")) {
          return JSON.stringify({
            scripts: {
              dev: "next dev",
              build: "next build",
              test: "vitest run",
            },
          });
        }
        throw new Error("ENOENT");
      });

      const results = await getSuggestions("ws-1", "/workspace", "BUILD");
      const values = results.map((s) => s.value);
      expect(values).toContain("npm run build");
      expect(values).not.toContain("npm run dev");
    });
  });

  describe("result limiting", () => {
    it("returns at most 20 suggestions", async () => {
      const { getSuggestions } = await import("@/lib/commands/autocomplete");

      const scripts: Record<string, string> = {};
      for (let i = 0; i < 30; i++) {
        scripts[`script-${i}`] = `echo ${i}`;
      }

      mockReadFile.mockImplementation(async (filePath) => {
        const pathStr =
          typeof filePath === "string" ? filePath : filePath.toString();
        if (pathStr.endsWith("package.json")) {
          return JSON.stringify({ scripts });
        }
        throw new Error("ENOENT");
      });

      const results = await getSuggestions("ws-1", "/workspace", "");
      expect(results.length).toBeLessThanOrEqual(20);
    });
  });
});
