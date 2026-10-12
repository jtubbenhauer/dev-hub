import * as monaco from "monaco-editor";
import * as monacoReact from "@monaco-editor/react";
import { MonacoVscodeApiWrapper } from "monaco-languageclient/vscodeApiWrapper";
import getLanguagesServiceOverride from "@codingame/monaco-vscode-languages-service-override";
import "@codingame/monaco-vscode-standalone-languages";
import {
  typescriptDefaults,
  javascriptDefaults,
} from "@codingame/monaco-vscode-standalone-typescript-language-features";
import "@codingame/monaco-vscode-standalone-json-language-features";
import "@codingame/monaco-vscode-standalone-css-language-features";
import "@codingame/monaco-vscode-standalone-html-language-features";
import { configureClassicWorkerFactory } from "@/lib/editor/monaco-workers";
import { trackBuiltinTs } from "@/lib/lsp/client/builtin-typescript";
import { openEditorFromLsp } from "@/lib/lsp/client/open-editor";

export { monacoReact };

export async function initializeMonacoStack() {
  // 25.1.2 contributions defer providers until onLanguage; no model may precede this gate.
  trackBuiltinTs(monaco);
  configureClassicWorkerFactory();
  await new MonacoVscodeApiWrapper({
    $type: "classic",
    viewsConfig: {
      $type: "EditorService",
      openEditorFunc: openEditorFromLsp,
    },
    // Classic mode reads semantic highlighting from the configuration service.
    userConfiguration: {
      json: JSON.stringify({
        "editor.experimental.asyncTokenization": true,
        "editor.semanticHighlighting.enabled": true,
      }),
    },
    monacoWorkerFactory: configureClassicWorkerFactory,
    serviceOverrides: getLanguagesServiceOverride(),
  }).start();
  for (const defaults of [typescriptDefaults, javascriptDefaults]) {
    defaults.setModeConfiguration({
      ...defaults.modeConfiguration,
      diagnostics: false,
    });
  }
  // 25.1.2 WorkerManager stops and clears its cached client on defaults.onDidChange.
  trackBuiltinTs(monaco, () => {
    for (const defaults of [typescriptDefaults, javascriptDefaults]) {
      defaults.setModeConfiguration({
        ...defaults.modeConfiguration,
        diagnostics: false,
      });
    }
  });
  monacoReact.loader.config({ monaco });
  window.__devhubMonaco = monaco;
  return { monaco, typescriptDefaults, javascriptDefaults };
}

// Keep the child chunk group inside the stack so its shared modules are already available.
export const loadLspClientRuntime = () =>
  import("@/lib/lsp/client/lsp-client-runtime");
