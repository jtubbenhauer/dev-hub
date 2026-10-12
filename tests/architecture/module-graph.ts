import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

export const PROJECT_ROOT = path.resolve(__dirname, "../..");

const RESOLVABLE_EXTENSIONS = [".ts", ".tsx", ".js", ".mjs"];

const EDITOR_PACKAGE_PATTERNS = [
  /^@codingame\//,
  /^monaco-editor(\/|$)/,
  /^monaco-languageclient(\/|$)/,
  /^vscode(\/|$)/,
  /^vscode-languageclient/,
  /^@monaco-editor\/react(\/|$)/,
];

export interface ModuleImport {
  readonly specifier: string;
  readonly isDynamic: boolean;
}

export interface EditorPackageImport {
  readonly file: string;
  readonly specifier: string;
}

export interface ModuleGraph {
  readonly reached: ReadonlySet<string>;
  readonly parentByFile: ReadonlyMap<string, string>;
  readonly editorPackageImports: readonly EditorPackageImport[];
}

const valueImportsByFile = new Map<string, readonly ModuleImport[]>();

function getScriptKind(filePath: string): ts.ScriptKind {
  if (filePath.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (filePath.endsWith(".ts")) return ts.ScriptKind.TS;
  return ts.ScriptKind.JS;
}

function isTypeOnlyImport(node: ts.ImportDeclaration): boolean {
  const importClause = node.importClause;
  if (!importClause) return false;
  if (importClause.isTypeOnly) return true;
  if (importClause.name) return false;
  const namedBindings = importClause.namedBindings;
  // `import { type A, type B } from "x"` is elided like `import type`.
  return (
    namedBindings !== undefined &&
    ts.isNamedImports(namedBindings) &&
    namedBindings.elements.length > 0 &&
    namedBindings.elements.every((element) => element.isTypeOnly)
  );
}

function isTypeOnlyExport(node: ts.ExportDeclaration): boolean {
  if (node.isTypeOnly) return true;
  const exportClause = node.exportClause;
  return (
    exportClause !== undefined &&
    ts.isNamedExports(exportClause) &&
    exportClause.elements.length > 0 &&
    exportClause.elements.every((element) => element.isTypeOnly)
  );
}

export function readValueImports(
  relativeFile: string,
): readonly ModuleImport[] {
  const cached = valueImportsByFile.get(relativeFile);
  if (cached) return cached;
  const absoluteFile = path.join(PROJECT_ROOT, relativeFile);
  const sourceFile = ts.createSourceFile(
    absoluteFile,
    readFileSync(absoluteFile, "utf8"),
    ts.ScriptTarget.Latest,
    false,
    getScriptKind(absoluteFile),
  );
  const imports: ModuleImport[] = [];
  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node)) {
      if (ts.isStringLiteral(node.moduleSpecifier) && !isTypeOnlyImport(node)) {
        imports.push({
          specifier: node.moduleSpecifier.text,
          isDynamic: false,
        });
      }
      return;
    }
    if (ts.isExportDeclaration(node)) {
      if (
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier) &&
        !isTypeOnlyExport(node)
      ) {
        imports.push({
          specifier: node.moduleSpecifier.text,
          isDynamic: false,
        });
      }
      return;
    }
    // `typeof import("x")` is an ImportTypeNode, not a call, so it never matches here.
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      const [firstArgument] = node.arguments;
      if (
        firstArgument &&
        (ts.isStringLiteral(firstArgument) ||
          ts.isNoSubstitutionTemplateLiteral(firstArgument))
      ) {
        imports.push({ specifier: firstArgument.text, isDynamic: true });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  valueImportsByFile.set(relativeFile, imports);
  return imports;
}

function isFile(absolutePath: string): boolean {
  return existsSync(absolutePath) && statSync(absolutePath).isFile();
}

export function resolveLocalImport(
  fromRelativeFile: string,
  specifier: string,
): string | null {
  let basePath: string;
  if (specifier.startsWith("@/")) {
    basePath = path.join(PROJECT_ROOT, specifier.slice(2));
  } else if (specifier.startsWith("./") || specifier.startsWith("../")) {
    basePath = path.resolve(
      path.dirname(path.join(PROJECT_ROOT, fromRelativeFile)),
      specifier,
    );
  } else {
    return null;
  }
  const candidates = [
    ...(RESOLVABLE_EXTENSIONS.includes(path.extname(basePath))
      ? [basePath]
      : []),
    ...RESOLVABLE_EXTENSIONS.map((extension) => `${basePath}${extension}`),
    ...RESOLVABLE_EXTENSIONS.map((extension) =>
      path.join(basePath, `index${extension}`),
    ),
  ];
  const resolved = candidates.find(isFile);
  return resolved ? toProjectRelative(resolved) : null;
}

function toProjectRelative(absolutePath: string): string {
  return path.relative(PROJECT_ROOT, absolutePath).split(path.sep).join("/");
}

export function isEditorPackageSpecifier(specifier: string): boolean {
  return EDITOR_PACKAGE_PATTERNS.some((pattern) => pattern.test(specifier));
}

export function walkModuleGraph(rootFiles: readonly string[]): ModuleGraph {
  const reached = new Set<string>(rootFiles);
  const parentByFile = new Map<string, string>();
  const editorPackageImports: EditorPackageImport[] = [];
  const queue = [...rootFiles];
  while (queue.length > 0) {
    const file = queue.shift();
    if (file === undefined) break;
    for (const { specifier } of readValueImports(file)) {
      if (isEditorPackageSpecifier(specifier)) {
        editorPackageImports.push({ file, specifier });
        continue;
      }
      const resolved = resolveLocalImport(file, specifier);
      if (resolved === null || reached.has(resolved)) continue;
      reached.add(resolved);
      parentByFile.set(resolved, file);
      queue.push(resolved);
    }
  }
  return { reached, parentByFile, editorPackageImports };
}

export function describeImportChain(
  graph: ModuleGraph,
  targetFile: string,
): string {
  const chain = [targetFile];
  let current = graph.parentByFile.get(targetFile);
  while (current !== undefined) {
    chain.unshift(current);
    current = graph.parentByFile.get(current);
  }
  return chain.join(" -> ");
}

function listFilesNamed(relativeDirectory: string, fileName: string): string[] {
  const absoluteDirectory = path.join(PROJECT_ROOT, relativeDirectory);
  return readdirSync(absoluteDirectory, { withFileTypes: true }).flatMap(
    (entry) => {
      const relativePath = `${relativeDirectory}/${entry.name}`;
      if (entry.isDirectory()) return listFilesNamed(relativePath, fileName);
      return entry.name === fileName ? [relativePath] : [];
    },
  );
}

export function listSegmentLayouts(pageFile: string): string[] {
  const segments = path.posix.dirname(pageFile).split("/");
  return segments
    .map((_, index) => `${segments.slice(0, index + 1).join("/")}/layout.tsx`)
    .filter((layoutFile) => isFile(path.join(PROJECT_ROOT, layoutFile)));
}

export interface PageReachability {
  readonly page: string;
  readonly isReachingTarget: boolean;
}

export function listPageReachability(
  targetFile: string,
): readonly PageReachability[] {
  return listFilesNamed("app", "page.tsx")
    .sort()
    .map((page) => ({
      page,
      isReachingTarget: walkModuleGraph([
        ...listSegmentLayouts(page),
        page,
      ]).reached.has(targetFile),
    }));
}
