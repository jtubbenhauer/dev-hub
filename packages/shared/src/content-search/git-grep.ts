import { sha256Utf8Hex } from "./line-hash";
import { buildMatch, stripLineEnding, utf8ByteOffsetToUtf16 } from "./preview";
import { runLineProcess } from "./process";
import type {
  ContentSearchMatch,
  ContentSearchOutcome,
  ContentSearchQuery,
} from "./types";

const escapeTranslations: Readonly<Record<string, string>> = {
  d: "[0-9]",
  D: "[^0-9]",
  s: "[[:space:]]",
  S: "[^[:space:]]",
  w: "[[:alnum:]_]",
  W: "[^[:alnum:]_]",
  t: "\t",
};

export function buildJsMatcher(query: ContentSearchQuery): RegExp {
  const source = query.isRegex
    ? query.pattern
    : query.pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    query.isWholeWord ? `(?<!\\w)(?:${source})(?!\\w)` : source,
    query.isCaseSensitive ? "g" : "gi",
  );
}

export function toPosixEre(
  pattern: string,
):
  | { readonly kind: "ok"; readonly source: string }
  | { readonly kind: "unsupported"; readonly construct: string } {
  let source = "";
  let isInBracket = false;
  let isPreviousQuantifier = false;
  for (let index = 0; index < pattern.length; index++) {
    const character = pattern.charAt(index);
    const next = pattern.charAt(index + 1);
    if (character === "\\") {
      const construct = character + next;
      if (isInBracket || next === "") return { kind: "unsupported", construct };
      const translation = escapeTranslations[next];
      if (translation !== undefined) source += translation;
      else if (".[]{}()*+?^$|\\".includes(next)) source += construct;
      else if (/[!-/:-@[-`{-~]/.test(next)) source += next;
      else return { kind: "unsupported", construct };
      index++;
      isPreviousQuantifier = false;
      continue;
    }
    if (character === "(" && next === "?") {
      if (pattern.charAt(index + 2) !== ":") {
        const construct = pattern.slice(index, index + 3);
        return { kind: "unsupported", construct };
      }
      if (!isInBracket) {
        source += "(";
        index += 2;
        isPreviousQuantifier = false;
        continue;
      }
    }
    if (character === "?" && isPreviousQuantifier) {
      const construct = pattern.slice(index - 1, index + 1);
      return { kind: "unsupported", construct };
    }
    isInBracket = character === "[" || (isInBracket && character !== "]");
    isPreviousQuantifier = "*+?}".includes(character);
    source += character;
  }
  return { kind: "ok", source };
}

export function toGitPathspecs(
  includeGlobs: readonly string[],
  excludeGlobs: readonly string[],
): string[] {
  const variants = (glob: string): string[] => {
    const normalized = glob.startsWith("./") ? glob.slice(2) : glob;
    const base = normalized.includes("/") ? normalized : `**/${normalized}`;
    return base.endsWith("**") ? [base] : [base, `${base}/**`];
  };
  return [
    ...new Set([
      ...(includeGlobs.length === 0
        ? ["."]
        : includeGlobs.flatMap(variants).map((glob) => `:(glob)${glob}`)),
      ...excludeGlobs.flatMap(variants).map((glob) => `:(exclude,glob)${glob}`),
      ":(exclude,glob)**/node_modules/**",
    ]),
  ];
}

export function pickGitGrepRanges(input: {
  readonly line: string;
  readonly gitColumn: number;
  readonly matcher: RegExp;
}): { start: number; end: number }[] {
  const { line, gitColumn, matcher } = input;
  const ranges = [...line.matchAll(matcher)]
    .filter((match) => match[0].length > 0)
    .map((match) => ({
      start: match.index,
      end: match.index + match[0].length,
    }));
  const start = utf8ByteOffsetToUtf16(line, gitColumn - 1);
  return ranges[0]?.start === start ? ranges : [{ start, end: start }];
}

export async function searchWithGitGrep(input: {
  readonly workspacePath: string;
  readonly query: ContentSearchQuery;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
}): Promise<ContentSearchOutcome> {
  const startedAt = performance.now();
  const { workspacePath, query, timeoutMs, signal } = input;
  let matcher: RegExp;
  try {
    matcher = buildJsMatcher(query);
  } catch (error) {
    if (error instanceof SyntaxError)
      return { kind: "invalid-pattern", message: error.message };
    throw error;
  }
  let pattern = query.pattern;
  if (query.isRegex) {
    const translated = toPosixEre(pattern);
    switch (translated.kind) {
      case "unsupported":
        return {
          kind: "invalid-pattern",
          message: `The git grep fallback can't run this regex (${translated.construct}). Install ripgrep (rg) for full regex support.`,
        };
      case "ok":
        pattern = translated.source;
        break;
      default: {
        const unreachable: never = translated;
        return unreachable;
      }
    }
  }
  const args = [
    "-c",
    "core.quotePath=false",
    "grep",
    "-z",
    "-n",
    "--column",
    "-I",
    "--untracked",
    "--no-color",
    ...(query.isCaseSensitive ? [] : ["-i"]),
    ...(query.isWholeWord ? ["-w"] : []),
    query.isRegex ? "-E" : "-F",
    "-e",
    pattern,
    "--",
    ...toGitPathspecs(query.includeGlobs, query.excludeGlobs),
  ];
  const matchesByPath = new Map<string, ContentSearchMatch[]>();
  let matchCount = 0;
  let isLimitHit = false;
  const result = await runLineProcess({
    command: "git",
    args,
    cwd: workspacePath,
    timeoutMs,
    ...(signal ? { signal } : {}),
    onLine(output) {
      const separator = output.indexOf("\0");
      if (separator < 0) return "continue";
      const fields = /^(\d+)[\0:](\d+)[\0:]([\s\S]*)$/.exec(
        output.slice(separator + 1),
      );
      if (!fields) return "continue";
      const [, lineNumber, gitColumn, text] = fields;
      const path = output.slice(0, separator);
      const line = stripLineEnding(text);
      const lineSha256 = sha256Utf8Hex(line);
      for (const range of pickGitGrepRanges({
        line,
        gitColumn: Number(gitColumn),
        matcher,
      })) {
        if (matchCount >= query.maxResults) {
          isLimitHit = true;
          return "stop";
        }
        const matches = matchesByPath.get(path) ?? [];
        matches.push(
          buildMatch({
            line,
            lineNumber: Number(lineNumber),
            ...range,
            lineSha256,
          }),
        );
        matchesByPath.set(path, matches);
        matchCount++;
      }
      return "continue";
    },
  });
  if (result.isAborted) return { kind: "failed", message: "Search cancelled" };
  if (result.spawnErrorCode === "ENOENT") {
    return {
      kind: "unavailable",
      message: "Content search needs ripgrep (rg) or git on the server",
    };
  }
  const { exitCode, stderr, isStopped, isTimedOut } = result;
  if (!isStopped && !isTimedOut && exitCode !== 0 && exitCode !== 1) {
    if (exitCode === 128 && stderr.includes("not a git repository")) {
      return {
        kind: "unavailable",
        message:
          "Install ripgrep (rg) to search folders that are not git repositories",
      };
    }
    if (
      exitCode === 128 &&
      (/^fatal: (-e option|command line), /m.test(stderr) ||
        /regular expression|regex|operand invalid|unmatched/i.test(stderr))
    ) {
      return {
        kind: "invalid-pattern",
        message: `The git grep fallback can't run this regex: ${stderr.trim().slice(0, 500)}`,
      };
    }
    return { kind: "failed", message: stderr };
  }
  const files = [...matchesByPath]
    .map(([path, matches]) => ({
      path,
      matches: matches.sort(
        (left, right) =>
          left.lineNumber - right.lineNumber ||
          left.startColumn - right.startColumn,
      ),
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
  return {
    kind: "ok",
    files,
    matchCount,
    fileCount: files.length,
    isLimitHit,
    isTimedOut: result.isTimedOut,
    engine: "git-grep",
    durationMs: performance.now() - startedAt,
  };
}
