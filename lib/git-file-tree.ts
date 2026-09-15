export interface FileTreeFolder<T> {
  name: string;
  path: string;
  folders: FileTreeFolder<T>[];
  files: T[];
}

function sortFoldersRecursive<T>(
  folder: FileTreeFolder<T>,
  folderOrder: "asc" | "desc",
): void {
  folder.folders.sort((a, b) =>
    folderOrder === "desc"
      ? b.name.localeCompare(a.name)
      : a.name.localeCompare(b.name),
  );
  for (const child of folder.folders) {
    sortFoldersRecursive(child, folderOrder);
  }
}

export function buildFileTree<T extends { path: string }>(
  items: T[],
  folderOrder: "asc" | "desc" = "asc",
): FileTreeFolder<T> {
  const root: FileTreeFolder<T> = {
    name: "",
    path: "",
    folders: [],
    files: [],
  };

  for (const item of items) {
    const segments = item.path.split("/");
    const fileName = segments.pop();
    if (fileName === undefined) continue;

    let current = root;
    let accumulatedPath = "";
    for (const segment of segments) {
      accumulatedPath = accumulatedPath
        ? `${accumulatedPath}/${segment}`
        : segment;
      let child = current.folders.find((folder) => folder.name === segment);
      if (!child) {
        child = {
          name: segment,
          path: accumulatedPath,
          folders: [],
          files: [],
        };
        current.folders.push(child);
      }
      current = child;
    }
    current.files.push(item);
  }

  sortFoldersRecursive(root, folderOrder);
  return root;
}

export function countTreeFiles<T>(folder: FileTreeFolder<T>): number {
  let count = folder.files.length;
  for (const child of folder.folders) {
    count += countTreeFiles(child);
  }
  return count;
}

export function flattenVisibleItems<T>(
  root: FileTreeFolder<T>,
  collapsedPaths: ReadonlySet<string>,
): T[] {
  const result: T[] = [];

  const visit = (folder: FileTreeFolder<T>): void => {
    for (const child of folder.folders) {
      if (collapsedPaths.has(child.path)) continue;
      visit(child);
    }
    for (const file of folder.files) {
      result.push(file);
    }
  };

  visit(root);
  return result;
}
