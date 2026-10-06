import { describe, expect, it } from "vitest";
import {
  fileUriToAbsolutePath,
  fileUriToWorkspaceRelativePath,
  isLspDocumentPath,
  isLspDocumentUriInWorkspace,
  lspLanguageIdForPath,
  monacoLanguageForPath,
  toLowerCaseUriKey,
  workspaceRelativePathToFileUri,
  workspaceRootToFileUri,
} from "@/lib/lsp/document-scope";
import {
  LSP_DOCUMENT_EXTENSIONS,
  buildLspWsUrl,
  isJsonRpcNotification,
  isJsonRpcRequest,
  isJsonRpcResponse,
} from "@/lib/lsp/types";

const WORKSPACE_ROOT = "/ws";

describe("workspaceRootToFileUri", () => {
  it("encodes each segment and strips the trailing slash", () => {
    expect(workspaceRootToFileUri("/Users/me/my project/")).toBe(
      "file:///Users/me/my%20project",
    );
    expect(workspaceRootToFileUri("/ws")).toBe("file:///ws");
  });
});

describe("round trip", () => {
  it.each(["my file.ts", "a#b.ts", "100%.ts", "ñ.ts", "src/dir x/a?b.tsx"])(
    "restores %s",
    (relativePath) => {
      const uri = workspaceRelativePathToFileUri(WORKSPACE_ROOT, relativePath);
      expect(uri.startsWith("file:///ws/")).toBe(true);
      expect(uri).not.toContain("#");
      expect(fileUriToAbsolutePath(uri)).toBe(`/ws/${relativePath}`);
      expect(fileUriToWorkspaceRelativePath(uri, WORKSPACE_ROOT)).toBe(
        relativePath,
      );
      expect(
        isLspDocumentUriInWorkspace(uri, WORKSPACE_ROOT, {
          isCaseInsensitive: false,
        }),
      ).toBe(true);
    },
  );
});

describe("fileUriToAbsolutePath", () => {
  it("returns null for non-file schemes and unparseable input", () => {
    expect(fileUriToAbsolutePath("inmemory://model/1")).toBeNull();
    expect(fileUriToAbsolutePath("not a uri")).toBeNull();
    expect(fileUriToAbsolutePath("file:///ws/%zz.ts")).toBeNull();
  });
});

describe("rejects", () => {
  it("rejects prefix collisions, outside paths, traversal, and non-file URIs", () => {
    expect(
      fileUriToWorkspaceRelativePath("file:///ws2/a.ts", WORKSPACE_ROOT),
    ).toBeNull();
    expect(
      fileUriToWorkspaceRelativePath(
        "file:///ws/../etc/passwd",
        WORKSPACE_ROOT,
      ),
    ).toBeNull();
    expect(
      fileUriToWorkspaceRelativePath("inmemory://model/1", WORKSPACE_ROOT),
    ).toBeNull();
    expect(
      fileUriToWorkspaceRelativePath("file:///ws", WORKSPACE_ROOT),
    ).toBeNull();
    expect(
      fileUriToWorkspaceRelativePath("file:///ws/", WORKSPACE_ROOT),
    ).toBeNull();
  });

  it("rejects traversal smuggled through encoded slashes", () => {
    const uri = "file:///ws/a%2F..%2F..%2Fx.ts";
    expect(fileUriToWorkspaceRelativePath(uri, WORKSPACE_ROOT)).toBeNull();
    expect(
      isLspDocumentUriInWorkspace(uri, WORKSPACE_ROOT, {
        isCaseInsensitive: false,
      }),
    ).toBe(false);
  });

  it("rejects out-of-scope documents for the in-workspace check", () => {
    const options = { isCaseInsensitive: false };
    expect(
      isLspDocumentUriInWorkspace("file:///ws2/a.ts", WORKSPACE_ROOT, options),
    ).toBe(false);
    expect(
      isLspDocumentUriInWorkspace(
        "inmemory://model/1",
        WORKSPACE_ROOT,
        options,
      ),
    ).toBe(false);
    expect(
      isLspDocumentUriInWorkspace(
        "file:///ws/readme.md",
        WORKSPACE_ROOT,
        options,
      ),
    ).toBe(false);
  });
});

describe("case insensitivity", () => {
  const lowercasedUri = toLowerCaseUriKey(
    workspaceRelativePathToFileUri("/Users/Me/Proj", "Src/App.ts"),
  );

  it("accepts a lowercased URI only when isCaseInsensitive is true", () => {
    expect(
      isLspDocumentUriInWorkspace(lowercasedUri, "/Users/Me/Proj", {
        isCaseInsensitive: false,
      }),
    ).toBe(false);
    expect(
      isLspDocumentUriInWorkspace(lowercasedUri, "/Users/Me/Proj", {
        isCaseInsensitive: true,
      }),
    ).toBe(true);
  });

  it("lowercases URI keys", () => {
    expect(toLowerCaseUriKey("file:///Users/Me/A.TS")).toBe(
      "file:///users/me/a.ts",
    );
  });
});

describe("extensions", () => {
  const languageIdByExtension: Record<string, string> = {
    ".ts": "typescript",
    ".mts": "typescript",
    ".cts": "typescript",
    ".tsx": "typescriptreact",
    ".js": "javascript",
    ".mjs": "javascript",
    ".cjs": "javascript",
    ".jsx": "javascriptreact",
  };
  const monacoLanguageByExtension: Record<string, string> = {
    ".ts": "typescript",
    ".mts": "typescript",
    ".cts": "typescript",
    ".tsx": "typescript",
    ".js": "javascript",
    ".mjs": "javascript",
    ".cjs": "javascript",
    ".jsx": "javascript",
  };

  it.each(LSP_DOCUMENT_EXTENSIONS)("maps %s to language ids", (extension) => {
    const path = `src/file${extension}`;
    expect(isLspDocumentPath(path)).toBe(true);
    expect(lspLanguageIdForPath(path)).toBe(languageIdByExtension[extension]);
    expect(monacoLanguageForPath(path)).toBe(
      monacoLanguageByExtension[extension],
    );
  });

  it("is case-insensitive on the extension and rejects other files", () => {
    expect(isLspDocumentPath("A.TSX")).toBe(true);
    expect(lspLanguageIdForPath("A.TSX")).toBe("typescriptreact");
    expect(isLspDocumentPath("a.json")).toBe(false);
    expect(isLspDocumentPath("Makefile")).toBe(false);
    expect(isLspDocumentPath("dir.ts/readme")).toBe(false);
    expect(lspLanguageIdForPath("a.py")).toBeNull();
    expect(monacoLanguageForPath("a.py")).toBeNull();
  });
});

describe("buildLspWsUrl", () => {
  it("encodes the workspace id", () => {
    expect(buildLspWsUrl(7601, "a b", 3)).toBe(
      "ws://127.0.0.1:7601/?workspaceId=a%20b&epoch=3",
    );
  });
});

describe("json-rpc guards", () => {
  it("treats id 0 as a request id", () => {
    const request = { jsonrpc: "2.0", id: 0, method: "initialize" };
    expect(isJsonRpcRequest(request)).toBe(true);
    expect(isJsonRpcNotification(request)).toBe(false);
    expect(isJsonRpcResponse(request)).toBe(false);
  });

  it("treats id 0 as a response id", () => {
    const response = { jsonrpc: "2.0", id: 0, result: null };
    expect(isJsonRpcResponse(response)).toBe(true);
    expect(isJsonRpcRequest(response)).toBe(false);
  });

  it("classifies notifications and rejects junk", () => {
    expect(
      isJsonRpcNotification({ jsonrpc: "2.0", method: "initialized" }),
    ).toBe(true);
    expect(isJsonRpcRequest({ jsonrpc: "2.0", method: "initialized" })).toBe(
      false,
    );
    expect(isJsonRpcRequest(null)).toBe(false);
    expect(isJsonRpcResponse("text")).toBe(false);
    expect(isJsonRpcResponse({ jsonrpc: "2.0", id: 1 })).toBe(false);
  });
});
