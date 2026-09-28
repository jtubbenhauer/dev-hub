import Database from "better-sqlite3";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  fingerprintSessions,
  canonicalizeDestinationPath,
  createVerifiedRetentionBackup,
  parseRetentionOptions,
  validateRetentionPaths,
  verifyRetentionBackup,
} from "@/lib/opencode/retention-maintenance";

const tempDirectories: string[] = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("parseRetentionOptions", () => {
  it("rejects partially numeric confirmation values", () => {
    expect(() =>
      parseRetentionOptions(["--confirm-delete-count", "2142oops"]),
    ).toThrow("positive integer");
  });

  it("defaults to a three-month dry run", () => {
    expect(parseRetentionOptions([])).toMatchObject({
      months: 3,
      isApply: false,
      confirmDeleteCount: null,
    });
  });
});

describe("validateRetentionPaths", () => {
  const base = {
    canonicalDatabasePath: "/data/opencode.db",
    databasePath: "/data/opencode.db",
    manifestPath: null,
    backupPath: "/backups/opencode.db",
    isApply: true,
  };

  it("rejects apply against a non-canonical database", () => {
    expect(() =>
      validateRetentionPaths({ ...base, databasePath: "/tmp/copy.db" }),
    ).toThrow("canonical database");
  });

  it("rejects manifest or backup collisions with the live database", () => {
    expect(() =>
      validateRetentionPaths({
        ...base,
        manifestPath: base.databasePath,
      }),
    ).toThrow("Manifest path");
    expect(() =>
      validateRetentionPaths({ ...base, backupPath: base.databasePath }),
    ).toThrow("Backup path");
    expect(() =>
      validateRetentionPaths({
        ...base,
        manifestPath: `${base.databasePath}-wal`,
      }),
    ).toThrow("sidecars");
  });

  it("rejects using one path for both manifest and backup", () => {
    expect(() =>
      validateRetentionPaths({
        ...base,
        manifestPath: "/tmp/output",
        backupPath: "/tmp/output",
      }),
    ).toThrow("must differ");
  });

  it("protects canonical database sidecars during override dry runs", () => {
    expect(() =>
      validateRetentionPaths({
        ...base,
        databasePath: "/tmp/copy.db",
        manifestPath: `${base.canonicalDatabasePath}-wal`,
        isApply: false,
      }),
    ).toThrow("sidecars");
  });

  it("protects sidecar paths case-insensitively", () => {
    expect(() =>
      validateRetentionPaths({
        ...base,
        manifestPath: "/DATA/OPENCODE.DB-WAL",
      }),
    ).toThrow("sidecars");
  });

  it("canonicalizes destination paths through symlinked parents", () => {
    const directory = mkdtempSync(join(tmpdir(), "opencode-paths-"));
    tempDirectories.push(directory);
    const realDirectory = join(directory, "real");
    const linkedDirectory = join(directory, "linked");
    mkdirSync(realDirectory);
    symlinkSync(realDirectory, linkedDirectory);

    expect(
      canonicalizeDestinationPath(join(linkedDirectory, "backup.db")),
    ).toBe(join(realpathSync(realDirectory), "backup.db"));
  });
});

describe("retention backup verification", () => {
  it("checks integrity and planned session presence", () => {
    const directory = mkdtempSync(join(tmpdir(), "opencode-retention-"));
    tempDirectories.push(directory);
    const databasePath = join(directory, "backup.db");
    const database = new Database(databasePath);
    database.exec("CREATE TABLE session (id TEXT PRIMARY KEY)");
    database.prepare("INSERT INTO session (id) VALUES (?)").run("session-1");
    database.close();

    expect(() =>
      verifyRetentionBackup(databasePath, ["session-1"]),
    ).not.toThrow();
    expect(() => verifyRetentionBackup(databasePath, ["missing"])).toThrow(
      "missing planned session",
    );
  });

  it("fingerprints session graph changes", () => {
    const session = {
      id: "session-1",
      parentId: null,
      timeUpdated: 1,
      directory: "/workspace",
      title: "Session",
    };

    expect(fingerprintSessions([session])).not.toBe(
      fingerprintSessions([{ ...session, timeUpdated: 2 }]),
    );
  });

  it("publishes backups without overwriting an existing destination", async () => {
    const directory = mkdtempSync(join(tmpdir(), "opencode-backup-"));
    tempDirectories.push(directory);
    const sourcePath = join(directory, "source.db");
    const backupPath = join(directory, "backup.db");
    const source = new Database(sourcePath);
    source.exec("CREATE TABLE session (id TEXT PRIMARY KEY)");
    source.prepare("INSERT INTO session (id) VALUES (?)").run("session-1");
    source.close();
    writeFileSync(backupPath, "existing");

    await expect(
      createVerifiedRetentionBackup(sourcePath, backupPath, ["session-1"]),
    ).rejects.toThrow();
    expect(readFileSync(backupPath, "utf8")).toBe("existing");
  });

  it("creates and verifies a new backup", async () => {
    const directory = mkdtempSync(join(tmpdir(), "opencode-backup-"));
    tempDirectories.push(directory);
    const sourcePath = join(directory, "source.db");
    const backupPath = join(directory, "backup.db");
    const source = new Database(sourcePath);
    source.exec("CREATE TABLE session (id TEXT PRIMARY KEY)");
    source.prepare("INSERT INTO session (id) VALUES (?)").run("session-1");
    source.close();

    await createVerifiedRetentionBackup(sourcePath, backupPath, ["session-1"]);

    expect(() =>
      verifyRetentionBackup(backupPath, ["session-1"]),
    ).not.toThrow();
  });
});
