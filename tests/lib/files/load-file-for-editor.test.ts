import { afterEach, describe, expect, it, vi } from "vitest";
import { loadFileForEditor } from "@/lib/files/load-file-for-editor";
import {
  BINARY_FILE_LANGUAGE,
  IMAGE_LANGUAGE,
  LARGE_FILE_LANGUAGE,
  PDF_LANGUAGE,
} from "@/lib/file-preview";

describe("loadFileForEditor", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ["docs/spec.pdf", PDF_LANGUAGE],
    ["assets/logo.png", IMAGE_LANGUAGE],
  ])("opens %s as a preview without fetching text", async (path, language) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(await loadFileForEditor("ws-1", path)).toEqual({
      content: "",
      language,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns text content and language from the content API", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ content: "const a = 1;", language: "typescript" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    expect(await loadFileForEditor("ws 1", "src/a b.ts")).toEqual({
      content: "const a = 1;",
      language: "typescript",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/files/content?workspaceId=ws%201&path=src%2Fa%20b.ts",
      { signal: undefined },
    );
  });

  it("defaults a missing language to plaintext", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ content: "notes" })),
    );

    expect(await loadFileForEditor("ws-1", "NOTES")).toEqual({
      content: "notes",
      language: "plaintext",
    });
  });

  it.each([
    [415, BINARY_FILE_LANGUAGE],
    [413, LARGE_FILE_LANGUAGE],
  ])(
    "marks a %i response as a file the editor cannot show",
    async (status, language) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => Response.json({ error: "refused" }, { status })),
      );

      expect(await loadFileForEditor("ws-1", "build/app.zip")).toEqual({
        content: "",
        language,
      });
    },
  );

  it.each([
    ["a 404", () => new Response(null, { status: 404 })],
    ["a malformed body", () => Response.json({ content: 7 })],
  ])("returns null for %s", async (_label, makeResponse) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => makeResponse()),
    );

    expect(await loadFileForEditor("ws-1", "missing.ts")).toBeNull();
  });

  it("passes the abort signal through and lets the abort propagate", async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        expect(init.signal).toBe(controller.signal);
        throw new DOMException("aborted", "AbortError");
      }),
    );
    controller.abort();

    await expect(
      loadFileForEditor("ws-1", "a.ts", { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
