import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { connectLspBrowserTransport } from "@/lib/lsp/client/browser-transport";
import { useDiagnosticsStore } from "@/stores/diagnostics-store";
import { useLspStore } from "@/stores/lsp-store";
import {
  createSessionFixture,
  fakeModel,
  fakeUri,
  sessionOptions,
} from "./lsp-session-fixture";

vi.mock("@/lib/lsp/client/browser-transport");
let session: typeof import("@/lib/lsp/client/lsp-session");
let fixture: ReturnType<typeof createSessionFixture>;

describe("native LSP session", () => {
  beforeEach(async () => {
    vi.resetModules();
    fixture = createSessionFixture();
    vi.doMock("@/stores/diagnostics-store", () => ({ useDiagnosticsStore }));
    vi.doMock("@/stores/lsp-store", () => ({ useLspStore }));
    session = await import("@/lib/lsp/client/lsp-session");
    vi.mocked(connectLspBrowserTransport).mockResolvedValue(fixture.transport);
    useDiagnosticsStore.getState().clearAllDiagnostics();
    useLspStore.setState({ isMonacoRegistered: false });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("rejects before connecting when Monaco has not registered", async () => {
    await expect(session.connectLspSession(sessionOptions)).rejects.toThrow(
      "Monaco not registered",
    );
    expect(connectLspBrowserTransport).not.toHaveBeenCalled();
  });

  it("retains the first instance when registration repeats", () => {
    const mark = vi.spyOn(useLspStore.getState(), "markMonacoRegistered");
    session.registerLspMonacoInstance(fixture.monaco);
    session.registerLspMonacoInstance(createSessionFixture().monaco);
    expect(session.getRegisteredLspMonaco()).toBe(fixture.monaco);
    expect(useLspStore.getState().isMonacoRegistered).toBe(true);
    expect(mark).toHaveBeenCalledTimes(1);
  });

  it("captures the feature store when the superclass constructor invokes the override", () => {
    const client = session.createDisposableLspClient(
      fixture.monaco,
      fixture.transport,
    );
    client.dispose();
    expect(fixture.construct).toHaveBeenCalledWith(fixture.transport);
    expect(fixture.features.dispose).toHaveBeenCalledTimes(1);
  });

  it("resolves decoded lower-case document URIs but returns encoded model URIs", async () => {
    fixture.models.push(fakeModel("file:///Workspace/My%20File.ts"));
    session.registerLspMonacoInstance(fixture.monaco);
    const handle = await session.connectLspSession(sessionOptions);
    const options = vi.mocked(connectLspBrowserTransport).mock.calls[0]?.[0];
    expect(options?.resolveDocumentUri("file:///workspace/my file.ts")).toBe(
      "file:///Workspace/My%20File.ts",
    );
    expect(
      options?.resolveDocumentUri("file:///workspace/missing.ts"),
    ).toBeNull();
    expect(
      options?.normalizeIncomingUri("file:///Workspace/My%20File.ts"),
    ).toBe("file:///Workspace/My File.ts");
    expect(fixture.Uri.parse).toHaveBeenCalledWith(
      "file:///Workspace/My%20File.ts",
    );
    expect(
      fixture.Uri.parse.mock.results[0]?.value.toString,
    ).toHaveBeenCalledWith(true);
    expect(options).toMatchObject({
      url: sessionOptions.wsUrl,
      workspaceRoot: sessionOptions.workspaceRoot,
      onUnexpectedClose: sessionOptions.onUnexpectedClose,
    });
    expect(await options?.resolveDefinitionTargets(null)).toBeNull();
    handle.dispose();
  });

  it("mirrors only scoped LSP markers and skips identical events from another owner", async () => {
    session.registerLspMonacoInstance(fixture.monaco);
    const handle = await session.connectLspSession(sessionOptions);
    const uri = fakeUri("file:///Workspace/src/My%20File.ts");
    fixture.editor.getModelMarkers.mockReturnValue([
      {
        owner: "lsp",
        resource: uri,
        severity: 8,
        message: "Mismatch",
        startLineNumber: 2,
        startColumn: 3,
        endLineNumber: 2,
        endColumn: 5,
        code: "2322",
      },
    ]);
    const write = vi.spyOn(
      useDiagnosticsStore.getState(),
      "setDiagnosticsForSource",
    );
    const listener = fixture.editor.onDidChangeMarkers.mock.calls[1]?.[0];
    listener?.([
      uri,
      fakeUri("file:///workspace/src/a.ts"),
      fakeUri("file:///Other/a.ts"),
      fakeUri("file:///Workspace/a.json"),
    ]);
    listener?.([fakeUri(uri.toString())]);
    expect(write).toHaveBeenCalledTimes(1);
    expect(fixture.editor.getModelMarkers).toHaveBeenCalledWith({
      owner: "lsp",
      resource: uri,
    });
    expect(
      useDiagnosticsStore
        .getState()
        .diagnosticsBySource.get(`${sessionOptions.workspaceId}:src/My File.ts`)
        ?.typescript,
    ).toEqual([
      {
        message: "Mismatch",
        severity: 1,
        code: "2322",
        source: "ts",
        range: { startLine: 2, startColumn: 3, endLine: 2, endColumn: 5 },
      },
    ]);
    fixture.editor.getModelMarkers.mockReturnValue([]);
    listener?.([uri]);
    expect(write).toHaveBeenCalledTimes(2);
    expect(
      useDiagnosticsStore
        .getState()
        .getDiagnosticsForFile(sessionOptions.workspaceId, "src/My File.ts"),
    ).toEqual([]);
    handle.dispose();
  });

  it("disposes once in the required order without restoring built-ins", async () => {
    session.registerLspMonacoInstance(fixture.monaco);
    const clear = vi
      .spyOn(useDiagnosticsStore.getState(), "clearSourceForWorkspace")
      .mockImplementation(() => {
        fixture.order.push("store");
      });
    const handle = await session.connectLspSession(sessionOptions);
    handle.dispose();
    handle.dispose();
    expect(handle.workspaceId).toBe(sessionOptions.workspaceId);
    expect(fixture.order).toEqual([
      "client",
      "transport",
      "markers",
      "mirror",
      "opener",
      "store",
    ]);
    expect(fixture.editor.removeAllMarkers).toHaveBeenCalledWith("lsp");
    expect(clear).toHaveBeenCalledWith(
      sessionOptions.workspaceId,
      "typescript",
    );
    expect(
      fixture.typescript.typescriptDefaults.setDiagnosticsOptions,
    ).toHaveBeenCalledTimes(1);
  });

  it.each(["transport", "client", "opener", "mirror"] as const)(
    "cleans acquired resources when %s construction throws",
    async (stage) => {
      const error = new Error(`${stage} failed`);
      const fail = () => {
        throw error;
      };
      switch (stage) {
        case "transport":
          vi.mocked(connectLspBrowserTransport).mockRejectedValueOnce(error);
          break;
        case "client":
          fixture.construct.mockImplementationOnce(fail);
          break;
        case "opener":
          fixture.editor.registerEditorOpener.mockImplementationOnce(fail);
          break;
        case "mirror":
          fixture.editor.onDidChangeMarkers
            .mockImplementationOnce(() => ({ dispose: vi.fn() }))
            .mockImplementationOnce(fail);
          break;
      }
      session.registerLspMonacoInstance(fixture.monaco);
      await expect(session.connectLspSession(sessionOptions)).rejects.toBe(
        error,
      );
      const expected = {
        transport: ["markers"],
        client: ["transport", "markers"],
        opener: ["client", "transport", "markers"],
        mirror: ["opener", "client", "transport", "markers"],
      };
      expect(fixture.order).toEqual(expected[stage]);
      expect(fixture.editor.removeAllMarkers).toHaveBeenCalledWith("lsp");
      expect(
        fixture.typescript.typescriptDefaults.setDiagnosticsOptions,
      ).toHaveBeenCalledTimes(1);
    },
  );
});
