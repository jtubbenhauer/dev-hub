import {
  BINARY_FILE_LANGUAGE,
  getBinaryPreviewLanguage,
  LARGE_FILE_LANGUAGE,
} from "@/lib/file-preview";

export interface EditorFileContent {
  readonly content: string;
  readonly language: string;
}

function isFileContentResponse(
  value: unknown,
): value is { content: string; language?: string } {
  if (typeof value !== "object" || value === null) return false;
  if (!("content" in value) || typeof value.content !== "string") return false;
  return !("language" in value) || typeof value.language === "string";
}

// Null means the file can't be read (missing, denied, malformed reply);
// network errors and aborts throw so callers can tell them apart.
export async function loadFileForEditor(
  workspaceId: string,
  path: string,
  options: { readonly signal?: AbortSignal } = {},
): Promise<EditorFileContent | null> {
  // PDFs and images preview from the raw file route, so there is no text to fetch.
  const previewLanguage = getBinaryPreviewLanguage(path);
  if (previewLanguage) return { content: "", language: previewLanguage };

  const response = await fetch(
    `/api/files/content?workspaceId=${encodeURIComponent(workspaceId)}&path=${encodeURIComponent(path)}`,
    { signal: options.signal },
  );
  if (response.status === 415) {
    return { content: "", language: BINARY_FILE_LANGUAGE };
  }
  if (response.status === 413) {
    return { content: "", language: LARGE_FILE_LANGUAGE };
  }
  if (!response.ok) return null;

  const data: unknown = await response.json();
  if (!isFileContentResponse(data)) return null;
  return { content: data.content, language: data.language ?? "plaintext" };
}
