// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { builtinEnvironments, type EnvironmentReturn } from "vitest/runtime";
import type { MonacoVscodeApiConfig } from "monaco-languageclient/vscodeApiWrapper";

const mocks = vi.hoisted(() => ({
  order: new Array<string>(),
  startGate: Promise.withResolvers<void>(),
  started: Promise.withResolvers<void>(),
  config: vi.fn(),
  captureWorkerReset: vi.fn<(reset: () => void) => void>(),
  worker: vi.fn<(url: URL, options: WorkerOptions) => void>(),
  workersReady: vi.fn<(isReady: boolean) => void>(),
  descriptors: vi.fn(),
  languageServices: { languageStatusService: {} },
  wrapper: vi.fn<(config: MonacoVscodeApiConfig) => void>(),
  typescriptDefaults: {
    modeConfiguration: {
      diagnostics: true,
      hovers: true,
      completionItems: true,
    },
    setModeConfiguration: vi.fn(),
  },
  javascriptDefaults: {
    modeConfiguration: {
      diagnostics: true,
      hovers: true,
      completionItems: true,
    },
    setModeConfiguration: vi.fn(),
  },
  createModel: vi.fn(() => {
    mocks.order.push("register-ts-providers");
    for (const defaults of [
      mocks.typescriptDefaults,
      mocks.javascriptDefaults,
    ]) {
      expect(defaults.setModeConfiguration).toHaveBeenCalledExactlyOnceWith({
        diagnostics: false,
        hovers: true,
        completionItems: true,
      });
    }
  }),
  addKeybindingRule: vi.fn(() => {
    mocks.order.push("addKeybindingRule");
  }),
}));

vi.mock("monaco-editor", () => {
  mocks.order.push("monaco-editor");
  return {
    editor: {
      createModel: mocks.createModel,
      addKeybindingRule: mocks.addKeybindingRule,
    },
  };
});
vi.mock("@/lib/lsp/client/builtin-typescript", () => {
  mocks.order.push("builtin-typescript");
  return {
    trackBuiltinTs: (_monaco: unknown, reset?: () => void) => {
      mocks.order.push("trackBuiltinTs");
      if (reset) mocks.captureWorkerReset(reset);
    },
  };
});
vi.mock("@codingame/monaco-vscode-languages-service-override", () => {
  mocks.order.push("language-services");
  return { default: () => mocks.languageServices };
});
vi.mock("monaco-languageclient/workerFactory", () => ({
  Worker: class {
    constructor(
      readonly url: URL,
      readonly options: WorkerOptions,
    ) {}
  },
  defineDefaultWorkerLoaders: () => ({}),
  useWorkerFactory: mocks.descriptors,
}));
vi.mock("monaco-languageclient/vscodeApiWrapper", () => {
  mocks.order.push("vscodeApiWrapper");
  return {
    MonacoVscodeApiWrapper: class {
      constructor(private readonly config: MonacoVscodeApiConfig) {
        mocks.wrapper(config);
      }
      async start() {
        mocks.workersReady(
          typeof globalThis.MonacoEnvironment?.getWorker === "function",
        );
        this.config.monacoWorkerFactory?.();
        mocks.order.push("start");
        mocks.started.resolve();
        await mocks.startGate.promise;
        mocks.order.push("started");
      }
    },
  };
});
vi.mock("@/lib/lsp/client/open-editor", () => {
  mocks.order.push("open-editor");
  return { openEditorFromLsp: () => Promise.resolve(undefined) };
});
vi.mock("@codingame/monaco-vscode-standalone-languages", () => {
  mocks.order.push("languages");
  return {};
});
vi.mock(
  "@codingame/monaco-vscode-standalone-typescript-language-features",
  () => {
    mocks.order.push(
      "@codingame/monaco-vscode-standalone-typescript-language-features",
    );
    return {
      typescriptDefaults: mocks.typescriptDefaults,
      javascriptDefaults: mocks.javascriptDefaults,
    };
  },
);
vi.mock("@codingame/monaco-vscode-standalone-json-language-features", () => {
  mocks.order.push("json");
  return {};
});
vi.mock("@codingame/monaco-vscode-standalone-css-language-features", () => {
  mocks.order.push("css");
  return {};
});
vi.mock("@codingame/monaco-vscode-standalone-html-language-features", () => {
  mocks.order.push("html");
  return {};
});
vi.mock("@monaco-editor/react", () => {
  mocks.order.push("react");
  return { loader: { config: mocks.config } };
});

describe("Monaco bootstrap in node", () => {
  it("rejects without importing browser modules when window is absent", async () => {
    // Given
    const bootstrap = await import("@/lib/editor/monaco-bootstrap");
    expect(typeof window).toBe("undefined");
    // When / Then
    await expect(bootstrap.ensureMonacoBootstrapped()).rejects.toThrow(
      "ensureMonacoBootstrapped requires window",
    );
    expect(mocks.order).toEqual([]);
    expect(bootstrap.getStandaloneTypeScriptDefaults()).toBeNull();
  });
});

describe("Monaco bootstrap in jsdom", () => {
  let environment: EnvironmentReturn;
  beforeAll(async () => {
    environment = await builtinEnvironments.jsdom.setup(globalThis, {});
    vi.stubGlobal(
      "Worker",
      class {
        constructor(url: URL, options: WorkerOptions) {
          mocks.worker(url, options);
        }
      },
    );
  });
  afterAll(async () => {
    delete globalThis.MonacoEnvironment;
    vi.unstubAllGlobals();
    await environment.teardown(globalThis);
  });

  it("gates concurrent callers until classic services and languages are ready", async () => {
    // Given
    const bootstrap = await import("@/lib/editor/monaco-bootstrap");
    // When
    const first = bootstrap.ensureMonacoBootstrapped();
    const second = bootstrap.ensureMonacoBootstrapped();
    const react = bootstrap.loadMonacoReact();
    await mocks.started.promise;
    // Then: nothing can mount before the wrapper finishes.
    expect(second).toBe(first);
    expect(bootstrap.getStandaloneTypeScriptDefaults()).toBeNull();
    expect(mocks.config).not.toHaveBeenCalled();
    expect(mocks.createModel).not.toHaveBeenCalled();
    expect(window.__devhubMonaco).toBeUndefined();
    expect(mocks.addKeybindingRule).not.toHaveBeenCalled();
    mocks.startGate.resolve();
    const monaco = await first;
    expect(await second).toBe(monaco);
    expect(await react).toBe(await import("@monaco-editor/react"));
    expect(window.__devhubMonaco).toBe(monaco);
    // Cmd+P must reach dev-hub's file picker, not VS Code's file-less quick open.
    expect(mocks.addKeybindingRule).toHaveBeenCalledExactlyOnceWith({
      keybinding: 0,
      command: "-workbench.action.quickOpen",
    });
    expect(mocks.order.indexOf("started")).toBeLessThan(
      mocks.order.indexOf("addKeybindingRule"),
    );
    expect(mocks.wrapper).toHaveBeenCalledOnce();
    expect(mocks.workersReady).toHaveBeenCalledExactlyOnceWith(true);
    expect(mocks.descriptors).not.toHaveBeenCalled();
    expect(mocks.wrapper).toHaveBeenCalledWith({
      $type: "classic",
      viewsConfig: {
        $type: "EditorService",
        openEditorFunc: expect.any(Function),
      },
      userConfiguration: {
        json: expect.any(String),
      },
      monacoWorkerFactory: expect.any(Function),
      serviceOverrides: mocks.languageServices,
    });
    const userSettings: unknown = JSON.parse(
      mocks.wrapper.mock.lastCall?.[0].userConfiguration?.json ?? "{}",
    );
    expect(userSettings).toEqual({
      "editor.experimental.asyncTokenization": true,
      "editor.semanticHighlighting.enabled": true,
    });
    monaco.editor.createModel("const value = 1", "typescript");
    expect(mocks.order.indexOf("trackBuiltinTs")).toBeLessThan(
      mocks.order.indexOf("register-ts-providers"),
    );
    expect(mocks.order.indexOf("started")).toBeLessThan(
      mocks.order.indexOf("register-ts-providers"),
    );
    expect(mocks.config).toHaveBeenCalledExactlyOnceWith({ monaco });
    expect(bootstrap.getStandaloneTypeScriptDefaults()).toEqual({
      typescriptDefaults: mocks.typescriptDefaults,
      javascriptDefaults: mocks.javascriptDefaults,
    });
    expect(mocks.captureWorkerReset).toHaveBeenCalledOnce();
    mocks.captureWorkerReset.mock.lastCall?.[0]();
    for (const defaults of [
      mocks.typescriptDefaults,
      mocks.javascriptDefaults,
    ]) {
      expect(defaults.setModeConfiguration).toHaveBeenLastCalledWith({
        ...defaults.modeConfiguration,
        diagnostics: false,
      });
      expect(defaults.setModeConfiguration).toHaveBeenCalledTimes(2);
    }
    const getWorker = globalThis.MonacoEnvironment?.getWorker;
    expect(getWorker).toBeTypeOf("function");
    expect(() => getWorker?.("workerMain.js", "TextMateWorker")).toThrow();
    const packages = {
      typescript: "typescript",
      javascript: "typescript",
      json: "json",
      css: "css",
      scss: "css",
      less: "css",
      html: "html",
      handlebars: "html",
      razor: "html",
    };
    for (const [label, language] of Object.entries(packages)) {
      const worker = getWorker?.("workerMain.js", label);
      expect(worker).toBeInstanceOf(Worker);
      expect(mocks.worker.mock.lastCall?.[0].toString()).toContain(
        `@codingame/monaco-vscode-standalone-${language}-language-features/worker`,
      );
      expect(mocks.worker.mock.lastCall?.[1]).toEqual({ type: "module" });
    }
    expect(getWorker?.("workerMain.js", "editorWorkerService")).toBeInstanceOf(
      Worker,
    );
    expect(mocks.worker.mock.lastCall?.[0].toString()).toContain(
      "@codingame/monaco-vscode-api/workers/editor.worker",
    );
  });
});
