import Database from "better-sqlite3";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const tempDirectories: string[] = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createFixture(isDeleteFailure = false) {
  const directory = mkdtempSync(join(tmpdir(), "opencode-cleanup-cli-"));
  tempDirectories.push(directory);
  const binDirectory = join(directory, "bin");
  const databasePath = join(directory, "opencode.db");
  const backupPath = join(directory, "backup.db");
  const logPath = join(directory, "commands.log");
  const database = new Database(databasePath);
  database.exec(`
    CREATE TABLE session (
      id TEXT PRIMARY KEY,
      parent_id TEXT,
      time_updated INTEGER NOT NULL,
      directory TEXT NOT NULL,
      title TEXT NOT NULL
    );
    INSERT INTO session VALUES ('root', NULL, 1, '/missing', 'Root');
    INSERT INTO session VALUES ('child', 'root', 2, '/missing', 'Child');
  `);
  database.close();
  mkdirSync(binDirectory);
  const opencodePath = join(binDirectory, "opencode");
  writeFileSync(
    opencodePath,
    `#!/bin/sh
echo "$@" >> "$FAKE_LOG"
if [ "$1" = "db" ] && [ "$2" = "path" ]; then
  echo "$FAKE_DB"
  exit 0
fi
if [ "$1" = "session" ] && [ "$2" = "delete" ]; then
  if [ "$FAKE_DELETE_FAILURE" = "1" ]; then exit 2; fi
  sqlite3 "$FAKE_DB" "WITH RECURSIVE tree(id) AS (SELECT '$3' UNION ALL SELECT s.id FROM session s JOIN tree ON s.parent_id=tree.id) DELETE FROM session WHERE id IN (SELECT id FROM tree);"
  exit $?
fi
exit 2
`,
  );
  chmodSync(opencodePath, 0o755);
  const lsofPath = join(binDirectory, "lsof");
  writeFileSync(lsofPath, '#!/bin/sh\necho "lsof $@" >> "$FAKE_LOG"\nexit 1\n');
  chmodSync(lsofPath, 0o755);
  return {
    databasePath,
    backupPath,
    logPath,
    env: {
      ...process.env,
      PATH: `${binDirectory}:${process.env.PATH ?? ""}`,
      FAKE_DB: databasePath,
      FAKE_LOG: logPath,
      FAKE_DELETE_FAILURE: isDeleteFailure ? "1" : "0",
    },
  };
}

function runCleanup(args: string[], env: NodeJS.ProcessEnv) {
  return spawnSync(
    "pnpm",
    ["exec", "tsx", "scripts/opencode-retention-cleanup.ts", ...args],
    { cwd: process.cwd(), env, encoding: "utf8" },
  );
}

describe("opencode retention cleanup CLI", () => {
  it("does not delete sessions during a dry run", () => {
    const fixture = createFixture();

    const result = runCleanup(["--months", "3"], fixture.env);

    expect(result.status).toBe(0);
    const database = new Database(fixture.databasePath, { readonly: true });
    expect(
      database.prepare("SELECT count(*) AS count FROM session").get(),
    ).toEqual({ count: 2 });
    database.close();
    expect(readFileSync(fixture.logPath, "utf8")).not.toContain(
      "session delete",
    );
  });

  it("backs up before deleting one old subtree and verifies descendants", () => {
    const fixture = createFixture();

    const result = runCleanup(
      [
        "--months",
        "3",
        "--apply",
        "--confirm-delete-count",
        "2",
        "--backup",
        fixture.backupPath,
      ],
      fixture.env,
    );

    expect(result.status).toBe(0);
    const live = new Database(fixture.databasePath, { readonly: true });
    expect(live.prepare("SELECT count(*) AS count FROM session").get()).toEqual(
      {
        count: 0,
      },
    );
    live.close();
    const backup = new Database(fixture.backupPath, { readonly: true });
    expect(
      backup.prepare("SELECT count(*) AS count FROM session").get(),
    ).toEqual({ count: 2 });
    backup.close();
    const log = readFileSync(fixture.logPath, "utf8");
    expect(log.match(/session delete/g)).toHaveLength(1);
    expect(log.match(/^lsof /gm)?.length).toBeGreaterThanOrEqual(3);
  });

  it("stops after a failed official deletion and preserves the backup", () => {
    const fixture = createFixture(true);

    const result = runCleanup(
      [
        "--apply",
        "--confirm-delete-count",
        "2",
        "--backup",
        fixture.backupPath,
      ],
      fixture.env,
    );

    expect(result.status).toBe(1);
    expect(() => verifyDatabaseCount(fixture.backupPath, 2)).not.toThrow();
    expect(() => verifyDatabaseCount(fixture.databasePath, 2)).not.toThrow();
    expect(
      readFileSync(fixture.logPath, "utf8").match(/session delete/g),
    ).toHaveLength(1);
  });
});

function verifyDatabaseCount(databasePath: string, expected: number): void {
  const database = new Database(databasePath, { readonly: true });
  try {
    expect(
      database.prepare("SELECT count(*) AS count FROM session").get(),
    ).toEqual({ count: expected });
  } finally {
    database.close();
  }
}
