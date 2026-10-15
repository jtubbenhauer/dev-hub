// Wire-format types for find-in-files content search, shared by the Next.js
// app (local workspaces) and the remote agent so both speak one contract.
// Pure TypeScript: no Node imports, safe for client bundles.

export interface ContentSearchQuery {
  readonly pattern: string;
  readonly isRegex: boolean;
  readonly isCaseSensitive: boolean;
  readonly isWholeWord: boolean;
  readonly includeGlobs: readonly string[];
  readonly excludeGlobs: readonly string[];
  readonly maxResults: number;
}

export interface ContentSearchMatch {
  // 1-based line number.
  readonly lineNumber: number;
  // 1-based UTF-16 column.
  readonly startColumn: number;
  // 1-based UTF-16 column, exclusive.
  readonly endColumn: number;
  // 1-based UTF-8 byte column, for Neovim.
  readonly startByteColumn: number;
  // fingerprintText() of the full matched text; for a zero-length
  // (cursor-only) match, of the whole source line.
  readonly matchFingerprint: string;
  // SHA-256 hex of the full source line's UTF-8 bytes (line ending stripped)
  // at search time; Neovim compares it with sha256(getline(n)).
  readonly lineSha256: string;
  readonly preview: string;
  // UTF-16 indexes into preview.
  readonly previewMatchStart: number;
  readonly previewMatchEnd: number;
}

export interface ContentSearchFile {
  // Workspace-relative, forward slashes, no "./".
  readonly path: string;
  readonly matches: readonly ContentSearchMatch[];
}

export type ContentSearchEngine = "ripgrep" | "git-grep";

export type ContentSearchOutcome =
  | {
      readonly kind: "ok";
      readonly files: readonly ContentSearchFile[];
      readonly matchCount: number;
      readonly fileCount: number;
      readonly isLimitHit: boolean;
      readonly isTimedOut: boolean;
      readonly engine: ContentSearchEngine;
      readonly durationMs: number;
    }
  | { readonly kind: "invalid-pattern"; readonly message: string }
  | { readonly kind: "unavailable"; readonly message: string }
  | { readonly kind: "failed"; readonly message: string };
