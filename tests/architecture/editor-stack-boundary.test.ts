import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  describeImportChain,
  listPageReachability,
  walkModuleGraph,
} from "./module-graph";

const ROOT_LAYOUT = "app/layout.tsx";
const MONACO_BOOTSTRAP = "lib/editor/monaco-bootstrap.ts";
const EDITOR_RUNTIME_FILES = [
  MONACO_BOOTSTRAP,
  "lib/editor/monaco-stack.ts",
  "lib/lsp/client/lsp-session.ts",
];

describe("editor stack boundary", () => {
  it("keeps editor runtime modules out of the root layout module graph", () => {
    const graph = walkModuleGraph([ROOT_LAYOUT]);
    const reachedRuntimeChains = EDITOR_RUNTIME_FILES.filter((file) =>
      graph.reached.has(file),
    ).map((file) => describeImportChain(graph, file));
    expect(reachedRuntimeChains).toEqual([]);
  });

  it("has no value imports of editor packages in the root layout module graph", () => {
    const graph = walkModuleGraph([ROOT_LAYOUT]);
    const editorPackageChains = graph.editorPackageImports.map(
      ({ file, specifier }) =>
        `${describeImportChain(graph, file)} -> ${specifier}`,
    );
    expect(editorPackageChains).toEqual([]);
  });

  it("reports which pages reach the Monaco bootstrap", () => {
    const reachability = listPageReachability(MONACO_BOOTSTRAP);
    // EDITOR_STACK_REPORT=<file> writes the per-page list for evidence.
    const reportFile = process.env.EDITOR_STACK_REPORT;
    if (reportFile) {
      const lines = reachability.map(
        ({ page, isReachingTarget }) =>
          `${isReachingTarget ? "reaches" : "clean  "}  ${page}`,
      );
      writeFileSync(reportFile, `${lines.join("\n")}\n`);
    }
    expect(reachability.length).toBeGreaterThan(0);
  }, 60_000);
});
