import { vi } from "vitest";

export function model(modelUri = "file:///repo/src/a.ts") {
  let content = "base";
  let version = 1;
  const range = {
    startLineNumber: 1,
    startColumn: 1,
    endLineNumber: 1,
    endColumn: 5,
  };
  return {
    uri: { toString: () => modelUri },
    getVersionId: () => version,
    getValue: () => content,
    getFullModelRange: () => range,
    isDisposed: vi.fn(() => false),
    type(text: string) {
      content = text;
      version++;
    },
    pushEditOperations: vi.fn(
      (
        _selections: readonly unknown[],
        edits: readonly { text: string }[],
        cursor: () => null,
      ) => {
        content = edits[0]?.text ?? content;
        version++;
        return cursor();
      },
    ),
  };
}

export function deferredResponse() {
  let resolve: (response: Response) => void = () => {
    throw new Error("uninitialized response");
  };
  const promise = new Promise<Response>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}
