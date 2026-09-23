export interface SshHostEntry {
  alias: string;
  hostName: string | null;
  port: number | null;
  user: string | null;
}

export type SshTargetResolution =
  | { kind: "resolved"; alias: string }
  | { kind: "none" }
  | { kind: "ambiguous"; candidates: string[] };

// Patterns are not usable as concrete Remote-SSH targets, so they are skipped.
function isPattern(alias: string): boolean {
  return alias.includes("*") || alias.includes("?") || alias.startsWith("!");
}

export function parseSshConfig(contents: string): SshHostEntry[] {
  const entries: SshHostEntry[] = [];
  let current: SshHostEntry[] = [];

  for (const rawLine of contents.split("\n")) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;

    // OpenSSH accepts "Key Value", "Key=Value" and "Key = Value".
    const match = /^([A-Za-z][A-Za-z0-9_-]*)(?:\s*=\s*|\s+)(.*)$/.exec(line);
    if (!match) continue;

    const key = match[1].toLowerCase();
    const value = match[2].trim();
    if (value.length === 0) continue;

    if (key === "host") {
      current = value
        .split(/\s+/)
        .filter((alias) => alias.length > 0 && !isPattern(alias))
        .map((alias) => ({ alias, hostName: null, port: null, user: null }));
      entries.push(...current);
      continue;
    }

    // A Match block ends the applicability of the preceding Host block.
    if (key === "match") {
      current = [];
      continue;
    }

    if (current.length === 0) continue;

    for (const entry of current) {
      if (key === "hostname") entry.hostName = value;
      else if (key === "user") entry.user = value;
      else if (key === "port") {
        const port = Number.parseInt(value, 10);
        entry.port = Number.isNaN(port) ? null : port;
      }
    }
  }

  return entries;
}

// Node imports stay dynamic so this module remains importable from the browser bundle.
export async function readSshConfig(
  configPath?: string,
): Promise<SshHostEntry[]> {
  try {
    const [{ homedir }, path, fs] = await Promise.all([
      import("node:os"),
      import("node:path"),
      import("node:fs/promises"),
    ]);
    const target = configPath ?? path.default.join(homedir(), ".ssh", "config");
    return parseSshConfig(await fs.default.readFile(target, "utf-8"));
  } catch {
    return [];
  }
}

// Container "69-oc-thing" and ssh alias "devrig-69-ws-thing" differ only by
// this type token; collapsing it makes the two directly comparable.
const CONTAINER_TYPE_TOKEN = /-(?:oc|ws|job|hub)-/g;

function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(CONTAINER_TYPE_TOKEN, "-");
}

function hostMatches(entryHost: string, wanted: string): boolean {
  // An alias may reference either the short host or a fully qualified form of
  // it (e.g. "dev-rig" vs "dev-rig.tailnet.ts.net").
  return (
    entryHost === wanted ||
    entryHost.startsWith(`${wanted}.`) ||
    wanted.startsWith(`${entryHost}.`)
  );
}

function resolveByKey(
  entries: SshHostEntry[],
  wantedHost: string,
  key: string,
): SshTargetResolution {
  const normalizedKey = normalizeKey(key);
  if (normalizedKey.length === 0) return { kind: "none" };

  const candidates = entries
    .filter((entry) => {
      const entryHost = entry.hostName?.trim().toLowerCase();
      if (!entryHost || !hostMatches(entryHost, wantedHost)) return false;
      const alias = normalizeKey(entry.alias);
      return alias === normalizedKey || alias.endsWith(`-${normalizedKey}`);
    })
    .map((entry) => entry.alias);

  const unique = [...new Set(candidates)];
  if (unique.length === 1) return { kind: "resolved", alias: unique[0] };
  if (unique.length === 0) return { kind: "none" };
  return { kind: "ambiguous", candidates: unique };
}

// matchKeys must be ordered most-reliable first (container id before name).
export function resolveSshAlias(
  entries: SshHostEntry[],
  hostName: string,
  matchKeys: string[],
): SshTargetResolution {
  const wantedHost = hostName.trim().toLowerCase();
  if (wantedHost.length === 0) return { kind: "none" };

  let ambiguous: SshTargetResolution | null = null;

  for (const key of matchKeys) {
    const result = resolveByKey(entries, wantedHost, key);
    if (result.kind === "resolved") return result;
    if (result.kind === "ambiguous" && !ambiguous) ambiguous = result;
  }

  return ambiguous ?? { kind: "none" };
}
