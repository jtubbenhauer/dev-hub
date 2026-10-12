// @vitest-environment node
import Module, { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NotebookDocumentSyncFeature } from "vscode-languageclient/lib/common/notebook";

type Disposable = { dispose(): void };

class WorkspaceEvent {
  readonly listeners = new Set<(...args: unknown[]) => void>();
  readonly event = vi.fn(
    (
      listener: (...args: unknown[]) => void,
      _thisArg?: unknown,
      disposables?: Disposable[],
    ) => {
      this.listeners.add(listener);
      const disposable = { dispose: () => this.listeners.delete(listener) };
      disposables?.push(disposable);
      return disposable;
    },
  );
}

const rootRequire = createRequire(import.meta.url);
const clientRequire = createRequire(
  rootRequire.resolve("monaco-languageclient"),
);
const notebookPath = clientRequire.resolve(
  "vscode-languageclient/lib/common/notebook.js",
);
const notebookRequire = createRequire(notebookPath);
const vscodePath = notebookRequire.resolve("vscode");
const client = {
  protocol2CodeConverter: { asDocumentSelector: () => [] },
};

// Only the constructor/register/clear seam needs this subset of the client API.
type NotebookModule = {
  readonly NotebookDocumentSyncFeature: new (
    featureClient: typeof client,
  ) => NotebookDocumentSyncFeature;
};

let feature: NotebookDocumentSyncFeature;
let textEvents: WorkspaceEvent[];
let notebookEvents: WorkspaceEvent[];
let previousVscode: NodeJS.Module | undefined;
let previousNotebook: NodeJS.Module | undefined;

beforeEach(() => {
  const openText = new WorkspaceEvent();
  const changeText = new WorkspaceEvent();
  const closeText = new WorkspaceEvent();
  const openNotebook = new WorkspaceEvent();
  const changeNotebook = new WorkspaceEvent();
  const closeNotebook = new WorkspaceEvent();
  textEvents = [openText, changeText, closeText];
  notebookEvents = [openNotebook, changeNotebook, closeNotebook];
  previousVscode = notebookRequire.cache[vscodePath];
  previousNotebook = notebookRequire.cache[notebookPath];
  const vscodeModule = new Module(vscodePath);
  vscodeModule.exports = {
    workspace: {
      notebookDocuments: [],
      onDidOpenTextDocument: openText.event,
      onDidChangeTextDocument: changeText.event,
      onDidCloseTextDocument: closeText.event,
      onDidOpenNotebookDocument: openNotebook.event,
      onDidChangeNotebookDocument: changeNotebook.event,
      onDidCloseNotebookDocument: closeNotebook.event,
    },
  };
  // Vitest's ESM mocks cannot intercept this package's CommonJS require("vscode").
  notebookRequire.cache[vscodePath] = vscodeModule;
  delete notebookRequire.cache[notebookPath];
  const notebook: NotebookModule = notebookRequire(notebookPath);
  feature = new notebook.NotebookDocumentSyncFeature(client);
});

afterEach(() => {
  feature?.clear();
  if (previousVscode) notebookRequire.cache[vscodePath] = previousVscode;
  else delete notebookRequire.cache[vscodePath];
  if (previousNotebook) notebookRequire.cache[notebookPath] = previousNotebook;
  else delete notebookRequire.cache[notebookPath];
});

const registration = { id: "first", registerOptions: { notebookSelector: [] } };

describe("installed notebook feature listener lifecycle", () => {
  it("subscribes to no workspace events when constructed without notebook support", () => {
    expect(textEvents.map((event) => event.listeners.size)).toEqual([0, 0, 0]);
    expect(notebookEvents.map((event) => event.listeners.size)).toEqual([
      0, 0, 0,
    ]);
  });

  it("installs three text listeners on first registration and shares them with the second", () => {
    // Given
    expect(textEvents.map((event) => event.event.mock.calls.length)).toEqual([
      0, 0, 0,
    ]);
    // When
    feature.register(registration);
    expect(textEvents.map((event) => event.listeners.size)).toEqual([1, 1, 1]);
    feature.register({ ...registration, id: "second" });
    // Then
    expect(textEvents.map((event) => event.event.mock.calls.length)).toEqual([
      1, 1, 1,
    ]);
    expect(textEvents.map((event) => event.listeners.size)).toEqual([1, 1, 1]);
  });

  it("disposes text and provider listeners when cleared repeatedly", () => {
    // Given
    feature.register(registration);
    feature.register({ ...registration, id: "second" });
    // When
    feature.clear();
    feature.clear();
    // Then
    expect(textEvents.map((event) => event.listeners.size)).toEqual([0, 0, 0]);
    expect(notebookEvents.map((event) => event.listeners.size)).toEqual([
      0, 0, 0,
    ]);
  });

  it("re-arms exactly three text listeners when registered after clear", () => {
    // Given
    feature.register(registration);
    feature.clear();
    // When
    feature.register({ ...registration, id: "restarted" });
    // Then
    expect(textEvents.map((event) => event.listeners.size)).toEqual([1, 1, 1]);
    expect(textEvents.map((event) => event.event.mock.calls.length)).toEqual([
      2, 2, 2,
    ]);
  });
});
