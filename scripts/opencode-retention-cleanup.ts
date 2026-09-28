import Database from "better-sqlite3";
import { existsSync, realpathSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { spawnSync } from "node:child_process";
import {
  calculateRetentionCutoff,
  planSessionRetention,
} from "../lib/opencode/retention";
import {
  assertDatabaseIsQuiescent,
  canonicalizeDestinationPath,
  createVerifiedRetentionBackup,
  fingerprintSessions,
  getOpenCodeDatabasePath,
  parseRetentionOptions,
  readRetentionSessions,
  validateRetentionPaths,
} from "../lib/opencode/retention-maintenance";

function printHelp(): void {
  console.log(`Usage: pnpm opencode:cleanup -- [options]

Dry-run is the default. Apply requires both a matching count and a backup path.
Stop Dev Hub and every OpenCode process before applying.

  --months N                 Retain sessions updated within N calendar months (default: 3)
  --manifest PATH            Write the complete dry-run plan as JSON
  --database PATH            Override the database from 'opencode db path'
  --apply                    Delete planned roots through 'opencode session delete'
  --confirm-delete-count N   Must equal the current number of sessions to delete
  --backup PATH              Mandatory online SQLite backup before --apply
  --help                     Show this help`);
}

async function main(): Promise<void> {
  const options = parseRetentionOptions(process.argv.slice(2));
  if (options.isHelp) {
    printHelp();
    return;
  }

  const canonicalDatabasePath = realpathSync(getOpenCodeDatabasePath());
  const databasePath = realpathSync(
    options.databasePath ?? canonicalDatabasePath,
  );
  const manifestPath = options.manifestPath
    ? canonicalizeDestinationPath(options.manifestPath)
    : null;
  const backupPath = options.backupPath
    ? canonicalizeDestinationPath(options.backupPath)
    : null;
  validateRetentionPaths({
    canonicalDatabasePath,
    databasePath,
    manifestPath,
    backupPath,
    isApply: options.isApply,
  });
  const sessions = readRetentionSessions(databasePath);
  const initialFingerprint = fingerprintSessions(sessions);
  const cutoff = calculateRetentionCutoff(new Date(), options.months);
  const plan = planSessionRetention({ sessions, cutoff });
  const sessionsById = new Map(
    sessions.map((session) => [session.id, session]),
  );
  const directoryCounts = new Map<string, number>();
  for (const sessionId of plan.deleteSessionIds) {
    const session = sessionsById.get(sessionId);
    if (!session) continue;
    directoryCounts.set(
      session.directory,
      (directoryCounts.get(session.directory) ?? 0) + 1,
    );
  }

  console.log(`Cutoff: ${new Date(cutoff).toISOString()}`);
  console.log(`Total sessions: ${sessions.length.toLocaleString()}`);
  console.log(
    `Retained sessions: ${plan.keepSessionIds.length.toLocaleString()}`,
  );
  console.log(
    `Sessions to delete: ${plan.deleteSessionIds.length.toLocaleString()}`,
  );
  console.log(
    `OpenCode delete calls: ${plan.deleteRootIds.length.toLocaleString()}`,
  );
  console.log("Largest deletion groups:");
  for (const [directory, count] of [...directoryCounts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 10)) {
    console.log(`  ${count.toLocaleString().padStart(6)}  ${directory}`);
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    databasePath,
    cutoff: new Date(cutoff).toISOString(),
    months: options.months,
    retainedSessionCount: plan.keepSessionIds.length,
    deletedSessionCount: plan.deleteSessionIds.length,
    deleteRootCount: plan.deleteRootIds.length,
    deleteRoots: plan.deleteRootIds.map((id) => sessionsById.get(id)),
  };
  if (manifestPath) {
    if (existsSync(manifestPath)) {
      throw new Error(`Manifest already exists: ${manifestPath}`);
    }
    await mkdir(dirname(manifestPath), { recursive: true });
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
      flag: "wx",
    });
    console.log(`Manifest: ${manifestPath}`);
  }

  if (!options.isApply) {
    console.log("Dry run only. No sessions were deleted.");
    console.log(
      `Apply with --apply --confirm-delete-count ${plan.deleteSessionIds.length} --backup <path>`,
    );
    return;
  }
  if (options.confirmDeleteCount !== plan.deleteSessionIds.length) {
    throw new Error(
      `Confirmation mismatch: expected ${plan.deleteSessionIds.length}, received ${options.confirmDeleteCount ?? "none"}`,
    );
  }
  if (!backupPath) {
    throw new Error("--backup is mandatory with --apply");
  }
  if (existsSync(backupPath)) {
    throw new Error(`Backup already exists: ${backupPath}`);
  }
  if (plan.deleteSessionIds.length === 0) {
    console.log("Nothing to delete.");
    return;
  }

  assertDatabaseIsQuiescent(databasePath);
  await mkdir(dirname(backupPath), { recursive: true });
  await createVerifiedRetentionBackup(
    databasePath,
    backupPath,
    plan.deleteSessionIds,
  );
  assertDatabaseIsQuiescent(databasePath);
  if (
    fingerprintSessions(readRetentionSessions(databasePath)) !==
    initialFingerprint
  ) {
    throw new Error(
      "Session database changed during backup; rerun the dry run",
    );
  }
  console.log(`Backup complete: ${backupPath}`);

  for (const [index, sessionId] of plan.deleteRootIds.entries()) {
    assertDatabaseIsQuiescent(databasePath);
    const session = sessionsById.get(sessionId);
    const cwd =
      session && existsSync(session.directory)
        ? session.directory
        : process.cwd();
    const result = spawnSync("opencode", ["session", "delete", sessionId], {
      cwd,
      encoding: "utf8",
    });
    if (result.status !== 0) {
      throw new Error(
        `Deletion failed for ${sessionId}: ${result.stderr.trim() || result.stdout.trim()}`,
      );
    }
    console.log(
      `[${index + 1}/${plan.deleteRootIds.length}] deleted ${sessionId}`,
    );
  }

  const verification = new Database(databasePath, { readonly: true });
  const remaining = plan.deleteSessionIds.filter((sessionId) => {
    const row = verification
      .prepare("SELECT 1 FROM session WHERE id = ?")
      .get(sessionId);
    return row !== undefined;
  });
  verification.close();
  if (remaining.length > 0) {
    throw new Error(
      `Verification failed for ${remaining.length} planned sessions`,
    );
  }
  console.log("Retention cleanup complete and verified.");
  console.log(
    'To shrink the file, stop OpenCode and run: opencode db "VACUUM"',
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
