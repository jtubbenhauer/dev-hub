import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  startDiagnosticsMirror,
  isLspMarkerOwner,
} from "@/lib/lsp/client/diagnostics-mirror";
import { markerToDiagnostic } from "@/lib/editor/diagnostics";
import { useDiagnosticsStore } from "@/stores/diagnostics-store";
import { createSessionFixture, fakeUri } from "./lsp-session-fixture";

beforeEach(() => useDiagnosticsStore.getState().clearAllDiagnostics());

function setupMirror() {
  const fixture = createSessionFixture();
  const resource = fakeUri("file:///Workspace/a.ts");
  const marker = {
    owner: "devhub-lsp",
    resource,
    message: "type mismatch",
    severity: 8,
    startLineNumber: 3,
    startColumn: 1,
    endLineNumber: 3,
    endColumn: 2,
  };
  return {
    fixture,
    resource,
    marker,
    start: () =>
      startDiagnosticsMirror({
        monaco: fixture.monaco,
        workspaceId: "workspace",
        workspaceRoot: "/Workspace",
      }),
  };
}

describe("diagnostics mirror", () => {
  it.each(["devhub-lsp", "devhub-lsp0", "devhub-lsp23"])(
    "accepts the source-backed owner %s when filtering markers",
    (owner) => {
      expect(isLspMarkerOwner(owner)).toBe(true);
    },
  );
  it.each([
    "typescript",
    "javascript",
    "eslint",
    "other",
    "devhub-lsp-foreign",
  ])("rejects the unrelated owner %s when filtering markers", (owner) => {
    expect(isLspMarkerOwner(owner)).toBe(false);
  });
  it("catches diagnostics published during initialization when the mirror starts", () => {
    const { fixture, marker, start } = setupMirror();
    fixture.editor.getModelMarkers.mockReturnValue([marker]);
    start();
    expect(
      useDiagnosticsStore.getState().getDiagnosticsForFile("workspace", "a.ts"),
    ).toEqual([markerToDiagnostic(marker)]);
  });
  it("ignores out-of-scope resources when marker events arrive", () => {
    const { fixture, start } = setupMirror();
    start();
    fixture.editor.getModelMarkers.mockClear();
    fixture.editor.onDidChangeMarkers.mock.calls[0][0]([
      fakeUri("file:///Workspace-other/a.ts"),
      fakeUri("inmemory:///Workspace/a.ts"),
      fakeUri("file:///Workspace/a.json"),
    ]);
    expect(fixture.editor.getModelMarkers).not.toHaveBeenCalled();
  });
  it("preserves ESLint and clears TypeScript when the collection removes its markers", () => {
    const { fixture, marker, resource, start } = setupMirror();
    const store = useDiagnosticsStore.getState();
    const eslint = [{ ...markerToDiagnostic(marker), source: "eslint" }];
    store.setDiagnosticsForSource("workspace", "a.ts", "eslint", eslint);
    store.setDiagnosticsForSource("workspace", "a.ts", "typescript", [
      markerToDiagnostic(marker),
    ]);
    start();
    fixture.editor.onDidChangeMarkers.mock.calls[0][0]([resource]);
    expect(
      useDiagnosticsStore.getState().diagnosticsBySource.get("workspace:a.ts"),
    ).toEqual({ eslint });
  });
  it("avoids duplicate store updates when markers are unchanged", () => {
    const { fixture, marker, resource, start } = setupMirror();
    fixture.editor.getModelMarkers.mockReturnValue([marker]);
    start();
    const listener = vi.fn();
    const unsubscribe = useDiagnosticsStore.subscribe(listener);
    fixture.editor.onDidChangeMarkers.mock.calls[0][0]([resource]);
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });
});
