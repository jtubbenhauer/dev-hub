import type { LanguageServiceDefaults } from "@codingame/monaco-vscode-standalone-typescript-language-features";
type StandaloneTypeScriptDefaults = {
  readonly typescriptDefaults: LanguageServiceDefaults;
  readonly javascriptDefaults: LanguageServiceDefaults;
};

let bootstrapPromise: Promise<typeof import("monaco-editor")> | undefined;
let standaloneTypeScriptDefaults: StandaloneTypeScriptDefaults | null = null;
let stackPromise:
  | Promise<typeof import("@/lib/editor/monaco-stack")>
  | undefined;

function loadStack() {
  return (stackPromise ??= import("@/lib/editor/monaco-stack"));
}

declare global {
  interface Window {
    __devhubMonaco?: typeof import("monaco-editor");
  }
}

export function getStandaloneTypeScriptDefaults(): StandaloneTypeScriptDefaults | null {
  return standaloneTypeScriptDefaults;
}

export function ensureMonacoBootstrapped(): Promise<
  typeof import("monaco-editor")
> {
  if (typeof window === "undefined")
    return Promise.reject(
      new Error("ensureMonacoBootstrapped requires window"),
    );
  bootstrapPromise ??= (async () => {
    const stack = await loadStack();
    const { monaco, typescriptDefaults, javascriptDefaults } =
      await stack.initializeMonacoStack();
    standaloneTypeScriptDefaults = { typescriptDefaults, javascriptDefaults };
    return monaco;
  })();
  return bootstrapPromise;
}

export function loadMonacoReact(): Promise<
  typeof import("@monaco-editor/react")
> {
  return ensureMonacoBootstrapped()
    .then(loadStack)
    .then((stack) => stack.monacoReact);
}

export async function loadLspClientRuntime() {
  await ensureMonacoBootstrapped();
  return (await loadStack()).loadLspClientRuntime();
}
