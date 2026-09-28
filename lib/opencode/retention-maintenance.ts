import Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { link, unlink } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import type { RetentionSession } from "@/lib/opencode/retention";

export interface RetentionOptions {
  months: number;
  isApply: boolean;
  confirmDeleteCount: number | null;
  backupPath: string | null;
  databasePath: string | null;
  manifestPath: string | null;
  isHelp: boolean;
}

interface RetentionPathValidation {
  readonly canonicalDatabasePath: string;
  readonly databasePath: string;
  readonly manifestPath: string | null;
  readonly backupPath: string | null;
  readonly isApply: boolean;
}

function readValue(args: string[], index: number, option: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${option} requires a value`);
  }
  return value;
}

function parsePositiveInteger(value: string, option: string): number {
  if (!/^[1-9][0-9]*$/.test(value)) {
    throw new Error(`${option} must be a positive integer`);
  }
  return Number(value);
}

export function parseRetentionOptions(args: string[]): RetentionOptions {
  const options: RetentionOptions = {
    months: 3,
    isApply: false,
    confirmDeleteCount: null,
    backupPath: null,
    databasePath: null,
    manifestPath: null,
    isHelp: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--") continue;
    if (argument === "--apply") options.isApply = true;
    else if (argument === "--help" || argument === "-h") options.isHelp = true;
    else if (argument === "--months") {
      options.months = parsePositiveInteger(
        readValue(args, index, argument),
        argument,
      );
      index += 1;
    } else if (argument === "--confirm-delete-count") {
      options.confirmDeleteCount = parsePositiveInteger(
        readValue(args, index, argument),
        argument,
      );
      index += 1;
    } else if (argument === "--backup") {
      options.backupPath = resolve(readValue(args, index, argument));
      index += 1;
    } else if (argument === "--database") {
      options.databasePath = resolve(readValue(args, index, argument));
      index += 1;
    } else if (argument === "--manifest") {
      options.manifestPath = resolve(readValue(args, index, argument));
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return options;
}

export function validateRetentionPaths({
  canonicalDatabasePath,
  databasePath,
  manifestPath,
  backupPath,
  isApply,
}: RetentionPathValidation): void {
  if (isApply && databasePath !== canonicalDatabasePath) {
    throw new Error(
      "--apply only supports the canonical database returned by 'opencode db path'",
    );
  }
  const protectedDatabasePaths = new Set(
    [canonicalDatabasePath, databasePath]
      .flatMap((path) => [
        path,
        `${path}-wal`,
        `${path}-shm`,
        `${path}-journal`,
      ])
      .map((path) => path.toLocaleLowerCase()),
  );
  if (
    manifestPath &&
    protectedDatabasePaths.has(manifestPath.toLocaleLowerCase())
  ) {
    throw new Error(
      "Manifest path cannot target the OpenCode database or sidecars",
    );
  }
  if (
    backupPath &&
    protectedDatabasePaths.has(backupPath.toLocaleLowerCase())
  ) {
    throw new Error(
      "Backup path cannot target the OpenCode database or sidecars",
    );
  }
  if (manifestPath && backupPath && manifestPath === backupPath) {
    throw new Error("Manifest and backup paths must differ");
  }
}

export function canonicalizeDestinationPath(filePath: string): string {
  const suffix: string[] = [basename(filePath)];
  let ancestor = dirname(filePath);
  while (!existsSync(ancestor)) {
    const parent = dirname(ancestor);
    if (parent === ancestor) break;
    suffix.unshift(basename(ancestor));
    ancestor = parent;
  }
  return join(realpathSync(ancestor), ...suffix);
}

function parseSessionRows(rows: unknown[]): RetentionSession[] {
  return rows.map((row) => {
    if (
      typeof row !== "object" ||
      row === null ||
      !("id" in row) ||
      typeof row.id !== "string" ||
      !("parent_id" in row) ||
      (row.parent_id !== null && typeof row.parent_id !== "string") ||
      !("time_updated" in row) ||
      typeof row.time_updated !== "number" ||
      !("directory" in row) ||
      typeof row.directory !== "string" ||
      !("title" in row) ||
      typeof row.title !== "string"
    ) {
      throw new Error("OpenCode returned a malformed session row");
    }
    return {
      id: row.id,
      parentId: row.parent_id,
      timeUpdated: row.time_updated,
      directory: row.directory,
      title: row.title,
    };
  });
}

export function getOpenCodeDatabasePath(): string {
  const result = spawnSync("opencode", ["db", "path"], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || "opencode db path failed");
  }
  const path = result.stdout.trim().split("\n").at(-1);
  if (!path) throw new Error("OpenCode returned an empty database path");
  return realpathSync(path);
}

export function readRetentionSessions(
  databasePath: string,
): RetentionSession[] {
  const database = new Database(databasePath, { readonly: true });
  try {
    return parseSessionRows(
      database
        .prepare(
          "SELECT id, parent_id, time_updated, directory, title FROM session ORDER BY time_updated, id",
        )
        .all(),
    );
  } finally {
    database.close();
  }
}

export function fingerprintSessions(
  sessions: readonly RetentionSession[],
): string {
  const hash = createHash("sha256");
  for (const session of sessions) {
    hash.update(
      `${session.id}\0${session.parentId ?? ""}\0${session.timeUpdated}\0${session.directory}\n`,
    );
  }
  return hash.digest("hex");
}

export function assertDatabaseIsQuiescent(databasePath: string): void {
  const result = spawnSync("lsof", ["-t", databasePath], { encoding: "utf8" });
  const pids = result.stdout.trim();
  if (pids) {
    throw new Error(
      `OpenCode database is in use by PID(s) ${pids.replaceAll("\n", ", ")}. Stop Dev Hub and every OpenCode process before --apply.`,
    );
  }
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(result.stderr.trim() || "Unable to check database users");
  }
}

export function verifyRetentionBackup(
  backupPath: string,
  expectedSessionIds: readonly string[],
): void {
  const backup = new Database(backupPath, { readonly: true });
  try {
    const quickCheck: unknown = backup.pragma("quick_check", { simple: true });
    if (quickCheck !== "ok")
      throw new Error("Backup PRAGMA quick_check failed");
    const lookup = backup.prepare("SELECT 1 FROM session WHERE id = ?");
    for (const sessionId of expectedSessionIds) {
      if (lookup.get(sessionId) === undefined) {
        throw new Error(`Backup is missing planned session ${sessionId}`);
      }
    }
  } finally {
    backup.close();
  }
}

export async function createVerifiedRetentionBackup(
  databasePath: string,
  backupPath: string,
  expectedSessionIds: readonly string[],
): Promise<void> {
  const temporaryPath = `${backupPath}.tmp-${process.pid}-${randomUUID()}`;
  try {
    const source = new Database(databasePath, { readonly: true });
    try {
      await source.backup(temporaryPath);
    } finally {
      source.close();
    }
    verifyRetentionBackup(temporaryPath, expectedSessionIds);
    await link(temporaryPath, backupPath);
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
}
