import type { MonacoVscodeApiConfig } from "monaco-languageclient/vscodeApiWrapper";

class UnsupportedMonacoWorkerError extends Error {
  constructor(readonly label: string) {
    super(`Unsupported classic Monaco worker: ${label}`);
    this.name = "UnsupportedMonacoWorkerError";
  }
}

export const configureClassicWorkerFactory: NonNullable<
  MonacoVscodeApiConfig["monacoWorkerFactory"]
> = () => {
  const environment = (globalThis.MonacoEnvironment ??= {});
  // Keep literal Worker/URL expressions so Turbopack bundles their dependencies.
  environment.getWorker = (_workerId, label) => {
    switch (label) {
      case "editorWorkerService":
        return new Worker(
          new URL(
            "@codingame/monaco-vscode-api/workers/editor.worker",
            import.meta.url,
          ),
          { type: "module" },
        );
      case "typescript":
      case "javascript":
        return new Worker(
          new URL(
            "@codingame/monaco-vscode-standalone-typescript-language-features/worker",
            import.meta.url,
          ),
          { type: "module" },
        );
      case "json":
        return new Worker(
          new URL(
            "@codingame/monaco-vscode-standalone-json-language-features/worker",
            import.meta.url,
          ),
          { type: "module" },
        );
      case "css":
      case "scss":
      case "less":
        return new Worker(
          new URL(
            "@codingame/monaco-vscode-standalone-css-language-features/worker",
            import.meta.url,
          ),
          { type: "module" },
        );
      case "html":
      case "handlebars":
      case "razor":
        return new Worker(
          new URL(
            "@codingame/monaco-vscode-standalone-html-language-features/worker",
            import.meta.url,
          ),
          { type: "module" },
        );
      default:
        throw new UnsupportedMonacoWorkerError(label);
    }
  };
};
