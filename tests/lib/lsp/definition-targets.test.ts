import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ensureDefinitionTargetModels } from "@/lib/lsp/client/lsp-session";
import {
  createSessionFixture,
  fakeModel,
  fakeSource,
} from "./lsp-session-fixture";

describe("ensureDefinitionTargetModels", () => {
  let fixture: ReturnType<typeof createSessionFixture>;
  let attachmentListeners: (() => void)[];
  const fetchContent = vi.fn<typeof fetch>();
  const range = {
    start: { line: 0, character: 0 },
    end: { line: 0, character: 4 },
  };
  const location = { uri: "file:///Workspace/src/My%20File.tsx", range };
  const prefetch = (result: unknown) =>
    ensureDefinitionTargetModels(
      fixture.monaco,
      result,
      "workspace & 1",
      "/Workspace",
    );
  beforeEach(() => {
    vi.useFakeTimers();
    fixture = createSessionFixture();
    attachmentListeners = [];
    fixture.editor.createModel.mockImplementation(
      (_content, _language, uri) => {
        const model = Object.assign(fakeModel(uri?.toString() ?? ""), {
          onDidChangeAttached: (listener: () => void) => {
            attachmentListeners.push(listener);
            return { dispose: vi.fn() };
          },
        });
        fixture.models.push(model);
        return model;
      },
    );
    fetchContent.mockReset();
    fetchContent.mockResolvedValue(
      new Response(JSON.stringify({ content: "export const view = <div />;" })),
    );
    vi.stubGlobal("fetch", fetchContent);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("preserves null without loading content", async () => {
    expect(await prefetch(null)).toBeNull();
    expect(fetchContent).not.toHaveBeenCalled();
  });
  it("creates a typed model when an in-scope target is missing", async () => {
    expect(await prefetch(location)).toBe(location);
    expect(fetchContent).toHaveBeenCalledWith(
      "/api/files/content?workspaceId=workspace%20%26%201&path=src%2FMy%20File.tsx",
    );
    expect(fixture.editor.createModel).toHaveBeenCalledWith(
      "export const view = <div />;",
      "typescript",
      expect.objectContaining({ toString: expect.any(Function) }),
    );
    expect(fixture.models[0]?.uri.toString()).toBe(location.uri);
  });
  it("keeps an existing model when encoded URI keys differ only in case", async () => {
    fixture.models.push(fakeModel(location.uri.toLowerCase()));
    expect(await prefetch([location])).toEqual([location]);
    expect(fetchContent).not.toHaveBeenCalled();
    expect(fixture.editor.createModel).not.toHaveBeenCalled();
  });
  it.each([
    "file:///Outside/a.ts",
    "file:///workspace/a.ts",
    "file:///Workspace/a.json",
    "inmemory://a.ts",
  ])("drops an out-of-scope target %s", async (uri) => {
    expect(await prefetch({ uri, range })).toBeNull();
    expect(fetchContent).not.toHaveBeenCalled();
    expect(fixture.editor.createModel).not.toHaveBeenCalled();
  });
  it("retains only valid locations and location links when a result is mixed", async () => {
    const link = {
      targetUri: location.uri,
      targetRange: range,
      targetSelectionRange: range,
    };
    expect(
      await prefetch([location, { uri: "file:///Outside/a.ts", range }, link]),
    ).toEqual([location, link]);
    expect(fixture.editor.createModel).toHaveBeenCalledTimes(1);
  });
  it("skips malformed entries when a result also contains valid locations", async () => {
    const fallback = { targetUri: null, uri: location.uri };
    const entries: unknown[] = [
      null,
      undefined,
      1,
      "invalid",
      true,
      [],
      { targetUri: 1, uri: location.uri },
      { targetUri: location.uri, uri: null },
      { targetUri: location.uri, uri: 1 },
      fallback,
      location,
    ];

    const result = await prefetch(entries);

    expect(result).toEqual([fallback, location]);
    expect(fetchContent).toHaveBeenCalledTimes(1);
    expect(fixture.editor.createModel).toHaveBeenCalledTimes(1);
  });
  it.each(["404", "network", "invalid content"])(
    "drops a target when content fetch fails with %s",
    async (failure) => {
      if (failure === "404")
        fetchContent.mockResolvedValue(new Response(null, { status: 404 }));
      if (failure === "network")
        fetchContent.mockRejectedValue(new TypeError("network failed"));
      if (failure === "invalid content")
        fetchContent.mockResolvedValue(
          new Response(JSON.stringify({ content: 1 })),
        );
      expect(await prefetch(location)).toBeNull();
      expect(fixture.editor.createModel).not.toHaveBeenCalled();
    },
  );
  it("disposes a prefetched model at ten seconds when no editor shows it", async () => {
    await prefetch(location);
    vi.advanceTimersByTime(9_999);
    expect(fixture.models[0]?.dispose).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fixture.models[0]?.dispose).toHaveBeenCalledTimes(1);
  });
  it("retains a prefetched model at expiry when an editor shows it", async () => {
    await prefetch(location);
    fixture.editors.push(fakeSource("files-page", fixture.models[0]));
    vi.advanceTimersByTime(10_000);
    expect(fixture.models[0]?.dispose).not.toHaveBeenCalled();
    fixture.editors.length = 0;
    vi.advanceTimersByTime(10_000);
    expect(fixture.models[0]?.dispose).toHaveBeenCalledOnce();
  });

  it("rechecks an embedded peek model and disposes only after detachment", async () => {
    await prefetch(location);
    const model = fixture.models[0];
    vi.mocked(model.isAttachedToEditor).mockReturnValue(true);
    vi.advanceTimersByTime(20_000);
    expect(model.dispose).not.toHaveBeenCalled();
    vi.mocked(model.isAttachedToEditor).mockReturnValue(false);
    vi.advanceTimersByTime(10_000);
    expect(model.dispose).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("waits a full quiet interval when a prefetched model was shown and hidden between checks", async () => {
    await prefetch(location);
    const model = fixture.models[0];
    for (const listener of attachmentListeners) listener();

    vi.advanceTimersByTime(10_000);

    expect(model.dispose).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10_000);
    expect(model.dispose).toHaveBeenCalledOnce();
  });

  it("stops checking when a prefetched model was already disposed", async () => {
    await prefetch(location);
    const model = fixture.models[0];
    model.dispose();
    vi.advanceTimersByTime(10_000);
    expect(model.dispose).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
