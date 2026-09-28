import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";

const SCAN_ROOTS = [
  "lib",
  "app",
  "packages/agent/src",
  "packages/shared/src",
  "hooks",
  "components",
  "stores",
  "scripts",
];
const SKIPPED_DIRECTORIES = new Set(["node_modules", ".next", "tests"]);
const SELF_BASENAME = "verify-omo-prohibitions.mjs";
const FORBIDDEN_DEPENDENCIES = ["@code-yeongyu/senpi", "omo-ai"];

function parseRoot(argv) {
  const rootOptionIndex = argv.indexOf("--root");
  if (rootOptionIndex === -1) return process.cwd();
  const rootValue = argv[rootOptionIndex + 1];
  if (rootValue === undefined || rootValue.startsWith("--")) {
    throw new TypeError("--root requires a directory");
  }
  return resolve(rootValue);
}

function walkFiles(directory) {
  if (!existsSync(directory)) return [];
  const files = [];
  const entries = readdirSync(directory, { withFileTypes: true }).sort(
    (left, right) => left.name.localeCompare(right.name),
  );
  for (const entry of entries) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) {
        files.push(...walkFiles(entryPath));
      }
      continue;
    }
    if (entry.isFile() && basename(entryPath) !== SELF_BASENAME) {
      files.push(entryPath);
    }
  }
  return files;
}

function stripComments(text) {
  let result = "";
  let state = "code";
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const nextCharacter = text[index + 1];
    if (state === "line-comment") {
      if (character === "\n" || character === "\r") {
        result += character;
        state = "code";
      } else {
        result += " ";
      }
      continue;
    }
    if (state === "block-comment") {
      if (character === "*" && nextCharacter === "/") {
        result += "  ";
        index += 1;
        state = "code";
      } else {
        result += character === "\n" || character === "\r" ? character : " ";
      }
      continue;
    }
    if (state !== "code") {
      result += character;
      if (character === "\\" && nextCharacter !== undefined) {
        result += nextCharacter;
        index += 1;
      } else if (
        (state === "single-quote" && character === "'") ||
        (state === "double-quote" && character === '"') ||
        (state === "template" && character === "`")
      ) {
        state = "code";
      }
      continue;
    }
    if (character === "/" && nextCharacter === "/") {
      result += "  ";
      index += 1;
      state = "line-comment";
    } else if (character === "/" && nextCharacter === "*") {
      result += "  ";
      index += 1;
      state = "block-comment";
    } else {
      result += character;
      if (character === "'") state = "single-quote";
      if (character === '"') state = "double-quote";
      if (character === "`") state = "template";
    }
  }
  return result;
}

function addMatches(violations, relativePath, text, pattern, message) {
  for (const match of text.matchAll(pattern)) {
    const line = text.slice(0, match.index).split("\n").length;
    violations.push(`${relativePath}:${line}: ${message}`);
  }
}

function scanSourceFile(root, filePath, violations) {
  const relativePath = relative(root, filePath).split(sep).join("/");
  const text = readFileSync(filePath, "utf8");
  const textWithoutComments = stripComments(text);
  const isLibOmo = relativePath.startsWith("lib/omo/");
  const isAgentOmo = relativePath.startsWith("packages/agent/src/omo/");
  const isSessionCache =
    relativePath.startsWith("app/api/sessions/") ||
    relativePath.startsWith("lib/message-cache");

  addMatches(
    violations,
    relativePath,
    textWithoutComments,
    /\[\s*"daemon"\s*,\s*"(?:stop|handoff)"/g,
    "daemon stop/handoff command is forbidden",
  );
  addMatches(
    violations,
    relativePath,
    textWithoutComments,
    /"host"\s*,\s*"(?:stop|handoff)"/g,
    "host stop/handoff command is forbidden",
  );
  if (isLibOmo) {
    addMatches(
      violations,
      relativePath,
      text,
      /permission\.(?:asked|replied)/g,
      "permission events are forbidden under lib/omo",
    );
    addMatches(
      violations,
      relativePath,
      text,
      /\b(?:execFile|spawn)(?:Sync|Async)?\s*\([^;]*?["']app-server["']/g,
      "app-server execution is forbidden under lib/omo",
    );
    addMatches(
      violations,
      relativePath,
      text,
      /process\.kill\s*\(/g,
      "host process signals are forbidden under lib/omo",
    );
    addMatches(
      violations,
      relativePath,
      text,
      /message\.removed/g,
      "message.removed is forbidden under lib/omo",
    );
  }
  if (isSessionCache) {
    addMatches(
      violations,
      relativePath,
      text,
      /omo_live_/g,
      "provisional ids are forbidden in persisted session caches",
    );
  }
  if (isLibOmo || isAgentOmo) {
    addMatches(
      violations,
      relativePath,
      text,
      /(?:\.secret|sendSocketHandshake)/g,
      "secret-file handshakes are forbidden",
    );
  }
  addMatches(
    violations,
    relativePath,
    text,
    /(?:media_placeholders|OMO_MAX_ATTACHED)/g,
    "client attachment limits and media_placeholders are forbidden",
  );
}

function packageManifestPaths(root) {
  const paths = [];
  const rootManifest = join(root, "package.json");
  if (existsSync(rootManifest)) paths.push(rootManifest);
  const packagesDirectory = join(root, "packages");
  if (!existsSync(packagesDirectory)) return paths;
  const packages = readdirSync(packagesDirectory, { withFileTypes: true }).sort(
    (left, right) => left.name.localeCompare(right.name),
  );
  for (const packageEntry of packages) {
    if (
      !packageEntry.isDirectory() ||
      SKIPPED_DIRECTORIES.has(packageEntry.name)
    ) {
      continue;
    }
    const manifestPath = join(
      packagesDirectory,
      packageEntry.name,
      "package.json",
    );
    if (existsSync(manifestPath)) paths.push(manifestPath);
  }
  return paths;
}

function scanPackageManifest(root, manifestPath, violations) {
  const relativePath = relative(root, manifestPath).split(sep).join("/");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  for (const sectionName of ["dependencies", "devDependencies"]) {
    const section = manifest[sectionName];
    if (
      section === null ||
      typeof section !== "object" ||
      Array.isArray(section)
    ) {
      continue;
    }
    for (const dependency of FORBIDDEN_DEPENDENCIES) {
      if (Object.hasOwn(section, dependency)) {
        violations.push(
          `${relativePath}: forbidden ${sectionName} entry "${dependency}"`,
        );
      }
    }
  }
}

function main() {
  const root = parseRoot(process.argv.slice(2));
  const violations = [];
  for (const scanRoot of SCAN_ROOTS) {
    for (const filePath of walkFiles(join(root, scanRoot))) {
      scanSourceFile(root, filePath, violations);
    }
  }
  for (const manifestPath of packageManifestPaths(root)) {
    scanPackageManifest(root, manifestPath, violations);
  }
  violations.sort((left, right) => left.localeCompare(right));
  if (violations.length === 0) {
    console.log("OK: 0 violations");
    return;
  }
  for (const violation of violations) console.log(violation);
  process.exitCode = 1;
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.log(`ERROR: ${message}`);
  process.exitCode = 1;
}
