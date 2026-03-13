// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import {
  validatePathWithinWorkspace,
  readDirectoryTree,
  readFileContent,
  writeFileContent,
  getLanguageFromFilename,
} from "@/lib/files/operations"

describe("validatePathWithinWorkspace", () => {
  it("allows a file directly inside the workspace", () => {
    const result = validatePathWithinWorkspace("/workspace", "file.txt")
    expect(result).toBe(path.resolve("/workspace/file.txt"))
  })

  it("allows nested paths within the workspace", () => {
    const result = validatePathWithinWorkspace("/workspace", "src/lib/utils.ts")
    expect(result).toBe(path.resolve("/workspace/src/lib/utils.ts"))
  })

  it("allows requesting the workspace root itself", () => {
    const result = validatePathWithinWorkspace("/workspace", ".")
    expect(result).toBe(path.resolve("/workspace"))
  })

  it("blocks path traversal via ../", () => {
    expect(() =>
      validatePathWithinWorkspace("/workspace", "../etc/passwd")
    ).toThrow("Path traversal denied")
  })

  it("blocks path traversal via deeply nested ../", () => {
    expect(() =>
      validatePathWithinWorkspace("/workspace", "src/../../etc/passwd")
    ).toThrow("Path traversal denied")
  })

  it("blocks absolute paths outside the workspace", () => {
    expect(() =>
      validatePathWithinWorkspace("/workspace", "/etc/passwd")
    ).toThrow("Path traversal denied")
  })

  it("blocks sibling directory access that shares a prefix", () => {
    // /workspace-evil is NOT inside /workspace even though it starts with /workspace
    expect(() =>
      validatePathWithinWorkspace("/workspace", "../workspace-evil/secret")
    ).toThrow("Path traversal denied")
  })
})

describe("getLanguageFromFilename", () => {
  it("detects TypeScript files", () => {
    expect(getLanguageFromFilename("utils.ts")).toBe("typescript")
    expect(getLanguageFromFilename("component.tsx")).toBe("typescript")
  })

  it("detects JavaScript files", () => {
    expect(getLanguageFromFilename("index.js")).toBe("javascript")
    expect(getLanguageFromFilename("config.mjs")).toBe("javascript")
    expect(getLanguageFromFilename("config.cjs")).toBe("javascript")
  })

  it("detects Dockerfile by basename regardless of extension", () => {
    expect(getLanguageFromFilename("Dockerfile")).toBe("dockerfile")
  })

  it("detects Makefile as shell", () => {
    expect(getLanguageFromFilename("Makefile")).toBe("shell")
  })

  it("returns plaintext for bare dotfiles like .env (path.extname returns empty string)", () => {
    // the language map has ".env" keyed but path.extname(".env") === "" so lookup misses
    expect(getLanguageFromFilename(".env")).toBe("plaintext")
  })

  it("maps .env.local-style extensions via the .local portion", () => {
    // path.extname(".env.local") === ".local" — not in the map → plaintext
    expect(getLanguageFromFilename(".env.local")).toBe("plaintext")
  })

  it("returns plaintext for unknown extensions", () => {
    expect(getLanguageFromFilename("data.xyz")).toBe("plaintext")
    expect(getLanguageFromFilename("README")).toBe("plaintext")
  })

  it("is case-insensitive for extensions", () => {
    expect(getLanguageFromFilename("Style.CSS")).toBe("css")
    expect(getLanguageFromFilename("readme.MD")).toBe("markdown")
  })

  it("maps YAML variants correctly", () => {
    expect(getLanguageFromFilename("config.yaml")).toBe("yaml")
    expect(getLanguageFromFilename("config.yml")).toBe("yaml")
  })

  it("maps GraphQL extensions", () => {
    expect(getLanguageFromFilename("schema.graphql")).toBe("graphql")
    expect(getLanguageFromFilename("query.gql")).toBe("graphql")
  })
})

describe("readDirectoryTree", () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-test-"))
    // Create a realistic workspace structure
    fs.mkdirSync(path.join(tmpDir, "src"))
    fs.writeFileSync(path.join(tmpDir, "src", "index.ts"), "export {}")
    fs.writeFileSync(path.join(tmpDir, "package.json"), "{}")
    fs.writeFileSync(path.join(tmpDir, ".env"), "SECRET=x")
    fs.mkdirSync(path.join(tmpDir, "node_modules"))
    fs.writeFileSync(path.join(tmpDir, "node_modules", "dep.js"), "")
    fs.mkdirSync(path.join(tmpDir, ".git"))
    fs.writeFileSync(path.join(tmpDir, ".git", "HEAD"), "ref: refs/heads/main")
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it("excludes node_modules and .git from results", () => {
    const tree = readDirectoryTree(tmpDir, tmpDir)
    const names = tree.map((e) => e.name)

    expect(names).not.toContain("node_modules")
    expect(names).not.toContain(".git")
  })

  it("includes dotfiles like .env that are not in the ignore list", () => {
    const tree = readDirectoryTree(tmpDir, tmpDir)
    const names = tree.map((e) => e.name)

    expect(names).toContain(".env")
  })

  it("sorts directories before files, both alphabetically", () => {
    const tree = readDirectoryTree(tmpDir, tmpDir)
    const dirEntries = tree.filter((e) => e.type === "directory")
    const fileEntries = tree.filter((e) => e.type === "file")

    // All directories come before all files
    const lastDirIndex = tree.findLastIndex((e) => e.type === "directory")
    const firstFileIndex = tree.findIndex((e) => e.type === "file")
    if (dirEntries.length > 0 && fileEntries.length > 0) {
      expect(lastDirIndex).toBeLessThan(firstFileIndex)
    }
  })

  it("returns relative paths from workspace root", () => {
    const tree = readDirectoryTree(tmpDir, tmpDir)
    for (const entry of tree) {
      expect(path.isAbsolute(entry.path)).toBe(false)
    }
  })

  it("does not recurse into subdirectories at depth 1", () => {
    const tree = readDirectoryTree(tmpDir, tmpDir, 1)
    const srcDir = tree.find((e) => e.name === "src")
    expect(srcDir).toBeDefined()
    expect(srcDir!.children).toBeUndefined()
  })

  it("recurses into subdirectories at depth 2", () => {
    const tree = readDirectoryTree(tmpDir, tmpDir, 2)
    const srcDir = tree.find((e) => e.name === "src")
    expect(srcDir).toBeDefined()
    expect(srcDir!.children).toBeDefined()
    expect(srcDir!.children!.some((c) => c.name === "index.ts")).toBe(true)
  })
})

describe("readFileContent", () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-test-"))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it("reads a text file and returns its content and size", () => {
    const content = "hello world"
    fs.writeFileSync(path.join(tmpDir, "test.txt"), content)

    const result = readFileContent(tmpDir, "test.txt")
    expect(result.content).toBe(content)
    expect(result.size).toBe(Buffer.byteLength(content))
  })

  it("throws for a non-existent file", () => {
    expect(() => readFileContent(tmpDir, "missing.txt")).toThrow("File not found")
  })

  it("throws when trying to read a directory", () => {
    fs.mkdirSync(path.join(tmpDir, "subdir"))
    expect(() => readFileContent(tmpDir, "subdir")).toThrow("Path is a directory")
  })

  it("throws for binary files containing null bytes", () => {
    const binary = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0d, 0x0a])
    fs.writeFileSync(path.join(tmpDir, "image.png"), binary)

    expect(() => readFileContent(tmpDir, "image.png")).toThrow("Binary file")
  })

  it("prevents path traversal when reading files", () => {
    expect(() => readFileContent(tmpDir, "../../../etc/passwd")).toThrow("Path traversal denied")
  })
})

describe("writeFileContent", () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-test-"))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it("creates the file with the given content", () => {
    writeFileContent(tmpDir, "new-file.txt", "hello")
    const written = fs.readFileSync(path.join(tmpDir, "new-file.txt"), "utf-8")
    expect(written).toBe("hello")
  })

  it("creates parent directories if they do not exist", () => {
    writeFileContent(tmpDir, "deep/nested/dir/file.txt", "nested content")
    const written = fs.readFileSync(path.join(tmpDir, "deep/nested/dir/file.txt"), "utf-8")
    expect(written).toBe("nested content")
  })

  it("prevents path traversal when writing files", () => {
    expect(() =>
      writeFileContent(tmpDir, "../../../tmp/evil.txt", "bad")
    ).toThrow("Path traversal denied")
  })
})
