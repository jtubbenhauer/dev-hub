import { describe, it, expect } from "vitest";
import { fuzzySearch } from "@/lib/fuzzy-match";

describe("fuzzySearch", () => {
  const paths = [
    "src/components/button.tsx",
    "src/components/dialog.tsx",
    "src/lib/utils.ts",
    "src/hooks/use-settings.ts",
    "package.json",
    "README.md",
    "src/components/file-picker/file-picker.tsx",
  ];

  it("returns all paths (up to maxResults) when query is empty", () => {
    const results = fuzzySearch("", paths);
    expect(results).toHaveLength(paths.length);
    // All scores should be 0, no highlights
    for (const r of results) {
      expect(r.score).toBe(0);
      expect(r.positions.size).toBe(0);
    }
  });

  it("respects maxResults for empty query", () => {
    const results = fuzzySearch("", paths, 3);
    expect(results).toHaveLength(3);
  });

  it("finds exact substring matches", () => {
    const results = fuzzySearch("button", paths);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].path).toBe("src/components/button.tsx");
    expect(results[0].score).toBeGreaterThan(0);
  });

  it("finds fuzzy matches across path segments", () => {
    const results = fuzzySearch("fp", paths);
    // Should match file-picker
    const fpMatch = results.find((r) => r.path.includes("file-picker"));
    expect(fpMatch).toBeDefined();
  });

  it("returns highlight positions for matched characters", () => {
    const results = fuzzySearch("utils", paths);
    const utilsMatch = results.find((r) => r.path.includes("utils"));
    expect(utilsMatch).toBeDefined();
    expect(utilsMatch!.positions.size).toBeGreaterThan(0);
  });

  it("returns empty array when nothing matches", () => {
    const results = fuzzySearch("zzzznotexist", paths);
    expect(results).toHaveLength(0);
  });

  it("ranks better matches higher", () => {
    const results = fuzzySearch("dialog", paths);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].path).toBe("src/components/dialog.tsx");
  });

  it("respects maxResults for non-empty query", () => {
    const manyPaths = Array.from({ length: 200 }, (_, i) => `file-${i}.ts`);
    const results = fuzzySearch("file", manyPaths, 10);
    expect(results.length).toBeLessThanOrEqual(10);
  });

  it("returns FuzzyMatch shape with required fields", () => {
    const results = fuzzySearch("json", paths);
    expect(results.length).toBeGreaterThanOrEqual(1);
    const match = results[0];
    expect(match).toHaveProperty("path");
    expect(match).toHaveProperty("score");
    expect(match).toHaveProperty("positions");
    expect(match.positions).toBeInstanceOf(Set);
  });

  describe("ranking and narrowing", () => {
    // Alphabetical, like `git ls-files`: the weaker matches come first.
    const migrationPaths = [
      "apps/api/lib/operations/list-patient-invoices.ts",
      "libs/ui/resolve-multi-patient-invoices/resolve-multi-patient-invoices.component.ts",
      "libs/migrations/d4w/destination/entities/patient-invoices.ts",
      "libs/migrations/exact/destination/entities/patient-invoices-v2.ts",
      "libs/migrations/exact/destination/entities/patient-invoices.ts",
      "libs/migrations/exact/source/entities/patient-invoice-lines.ts",
    ];

    it("ranks files named exactly like the query above paths that only contain it", () => {
      // When
      const results = fuzzySearch("patient-invoices", migrationPaths);

      // Then
      expect(results.slice(0, 3).map((r) => r.path)).toEqual([
        "libs/migrations/d4w/destination/entities/patient-invoices.ts",
        "libs/migrations/exact/destination/entities/patient-invoices.ts",
        "libs/migrations/exact/destination/entities/patient-invoices-v2.ts",
      ]);
    });

    it("ranks a file name that starts with the query above one that only contains it", () => {
      // When
      const results = fuzzySearch("patient-invoices", migrationPaths);

      // Then
      const paths = results.map((r) => r.path);
      expect(
        paths.indexOf(
          "libs/migrations/exact/destination/entities/patient-invoices-v2.ts",
        ),
      ).toBeLessThan(
        paths.indexOf("apps/api/lib/operations/list-patient-invoices.ts"),
      );
    });

    it("narrows results to paths matching every space-separated term", () => {
      // When
      const results = fuzzySearch("exact  patient-invoices", migrationPaths);

      // Then
      expect(results.map((r) => r.path)).toEqual([
        "libs/migrations/exact/destination/entities/patient-invoices.ts",
        "libs/migrations/exact/destination/entities/patient-invoices-v2.ts",
        // Still a fuzzy match for both terms, so it stays, ranked last.
        "libs/migrations/exact/source/entities/patient-invoice-lines.ts",
      ]);
    });

    it("matches space-separated terms in any order", () => {
      // When
      const results = fuzzySearch("patient-invoices exact", migrationPaths);

      // Then
      expect(results[0]?.path).toBe(
        "libs/migrations/exact/destination/entities/patient-invoices.ts",
      );
    });

    it("treats a whitespace-only query like an empty query", () => {
      // When
      const results = fuzzySearch("   ", migrationPaths);

      // Then
      expect(results.map((r) => r.path)).toEqual(migrationPaths);
      expect(results.every((r) => r.positions.size === 0)).toBe(true);
    });
  });
});
