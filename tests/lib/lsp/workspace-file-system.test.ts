// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { URI } from "@codingame/monaco-vscode-api/vscode/vs/base/common/uri";
import {
  FileSystemProviderCapabilities,
  FileSystemProviderError,
  FileSystemProviderErrorCode,
  FileType,
} from "@codingame/monaco-vscode-api/vscode/vs/platform/files/common/files";
import { createWorkspaceFileSystemProvider } from "@/lib/lsp/client/workspace-file-system";

const workspaceRoot = "/Workspace/my repo";
const insideUri = URI.file(`${workspaceRoot}/src/a.ts`);
const outsideUri = URI.file("/elsewhere/lib.d.ts");
const fetchMock = vi.fn<typeof fetch>();
let provider: ReturnType<typeof createWorkspaceFileSystemProvider>;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

function requestedUrls(): string[] {
  return fetchMock.mock.calls.map(([input]) => String(input));
}

async function rejectionOf(operation: Promise<unknown>) {
  const error: unknown = await operation.then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(FileSystemProviderError);
  return error instanceof FileSystemProviderError ? error.code : null;
}

const fileStat = { type: "file", size: 20, mtime: 111, ctime: 99 };

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  provider = createWorkspaceFileSystemProvider({
    workspaceId: "ws 1",
    workspaceRoot,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("workspace file system provider", () => {
  it("declares read-write, case-sensitive capabilities without the Readonly bit", () => {
    expect(provider.capabilities).toBe(
      FileSystemProviderCapabilities.FileReadWrite |
        FileSystemProviderCapabilities.PathCaseSensitive,
    );
  });

  it("stats the workspace root URI as a directory with an empty path", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ type: "directory", size: 64, mtime: 5, ctime: 4 }),
    );
    const stat = await provider.stat(URI.file(workspaceRoot));
    expect(stat).toEqual({
      type: FileType.Directory,
      size: 64,
      mtime: 5,
      ctime: 4,
    });
    const url = new URL(requestedUrls()[0], "http://localhost");
    expect(url.pathname).toBe("/api/files/stat");
    expect(url.searchParams.get("workspaceId")).toBe("ws 1");
    expect(url.searchParams.get("path")).toBe("");
    expect(url.searchParams.has("content")).toBe(false);
  });

  it("stats a workspace file by its relative path", async () => {
    fetchMock.mockResolvedValue(jsonResponse(fileStat));
    const stat = await provider.stat(insideUri);
    expect(stat).toEqual({
      type: FileType.File,
      size: 20,
      mtime: 111,
      ctime: 99,
    });
    const url = new URL(requestedUrls()[0], "http://localhost");
    expect(url.searchParams.get("path")).toBe("src/a.ts");
  });

  it("maps a 404 stat to FileNotFound so the overlay falls through", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "Not found" }, 404));
    expect(await rejectionOf(provider.stat(insideUri))).toBe(
      FileSystemProviderErrorCode.FileNotFound,
    );
  });

  it("reads file text through the stat route with content=1", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ ...fileStat, content: "export const a = 1;\n" }),
    );
    const bytes = await provider.readFile(insideUri);
    expect(new TextDecoder().decode(bytes)).toBe("export const a = 1;\n");
    const url = new URL(requestedUrls()[0], "http://localhost");
    expect(url.pathname).toBe("/api/files/stat");
    expect(url.searchParams.get("path")).toBe("src/a.ts");
    expect(url.searchParams.get("content")).toBe("1");
    expect(
      requestedUrls().some((entry) => entry.includes("/api/files/content")),
    ).toBe(false);
  });

  it("returns an empty listing for workspace directories", async () => {
    expect(await provider.readdir(URI.file(workspaceRoot))).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  describe("rejects", () => {
    it("throws FileNotFound without a request for reads outside the workspace", async () => {
      expect(await rejectionOf(provider.readFile(outsideUri))).toBe(
        FileSystemProviderErrorCode.FileNotFound,
      );
      expect(await rejectionOf(provider.stat(outsideUri))).toBe(
        FileSystemProviderErrorCode.FileNotFound,
      );
      expect(
        await rejectionOf(
          provider.readFile(URI.file("/Workspace/my repository/a.ts")),
        ),
      ).toBe(FileSystemProviderErrorCode.FileNotFound);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each([
      [
        "writeFile",
        () =>
          provider.writeFile(insideUri, new Uint8Array(), {
            create: true,
            overwrite: true,
            unlock: false,
            atomic: false,
          }),
      ],
      [
        "delete",
        () =>
          provider.delete(insideUri, {
            recursive: false,
            useTrash: false,
            atomic: false,
          }),
      ],
      [
        "rename",
        () => provider.rename(outsideUri, insideUri, { overwrite: true }),
      ],
      ["mkdir", () => provider.mkdir(URI.file(`${workspaceRoot}/new-dir`))],
    ])(
      "%s inside the workspace throws a code the overlay does not fall through",
      async (_operation, run) => {
        const code = await rejectionOf(run());
        expect(code).toBe(FileSystemProviderErrorCode.FileWriteLocked);
        expect([
          FileSystemProviderErrorCode.FileNotFound,
          FileSystemProviderErrorCode.NoPermissions,
          FileSystemProviderErrorCode.Unavailable,
        ]).not.toContain(code);
        expect(fetchMock).not.toHaveBeenCalled();
      },
    );

    it("lets writes outside the workspace fall through with FileNotFound", async () => {
      const code = await rejectionOf(
        provider.writeFile(outsideUri, new Uint8Array(), {
          create: true,
          overwrite: true,
          unlock: false,
          atomic: false,
        }),
      );
      expect(code).toBe(FileSystemProviderErrorCode.FileNotFound);
    });
  });
});
