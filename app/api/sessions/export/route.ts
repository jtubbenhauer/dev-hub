import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { OpenCodeTargetError } from "@/lib/opencode/proxy-target";
import {
  loadSessionForExport,
  type SessionExportSource,
} from "@/lib/opencode/session-export";
import { formatTranscript } from "@/lib/opencode/session-transcript";
import { getBackend } from "@/lib/workspaces/backend";

// Same ceiling as the file viewer: anything bigger can't be shown in the
// browser, so it has to be exported to a file instead.
const MAX_PREVIEW_BYTES = 5 * 1024 * 1024;

// Loading a long session's full history can take a while.
export const maxDuration = 300;

interface ExportRequest {
  readonly workspaceId: string;
  readonly sessionId: string;
  readonly filename: string;
  readonly thinking: boolean;
  readonly toolDetails: boolean;
  readonly assistantMetadata: boolean;
  readonly openWithoutSaving: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseExportRequest(value: unknown): ExportRequest | null {
  if (!isRecord(value)) return null;
  const {
    workspaceId,
    sessionId,
    filename,
    thinking,
    toolDetails,
    assistantMetadata,
    openWithoutSaving,
  } = value;
  if (
    typeof workspaceId !== "string" ||
    workspaceId === "" ||
    typeof sessionId !== "string" ||
    sessionId === "" ||
    typeof filename !== "string" ||
    typeof thinking !== "boolean" ||
    typeof toolDetails !== "boolean" ||
    typeof assistantMetadata !== "boolean" ||
    typeof openWithoutSaving !== "boolean"
  ) {
    return null;
  }
  return {
    workspaceId,
    sessionId,
    filename: filename.trim(),
    thinking,
    toolDetails,
    assistantMetadata,
    openWithoutSaving,
  };
}

function loadFailureResponse(error: unknown): NextResponse {
  if (error instanceof OpenCodeTargetError) {
    return NextResponse.json(
      error.detail
        ? { error: error.message, detail: error.detail }
        : { error: error.message },
      { status: error.status },
    );
  }
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return NextResponse.json(
      { error: "Timed out loading the session" },
      { status: 504 },
    );
  }
  if (error instanceof Error) {
    return NextResponse.json(
      { error: "Failed to load session", detail: error.message },
      { status: 502 },
    );
  }
  throw error;
}

// Mirrors the TUI's /export: formats the full session as Markdown, then either
// saves it to the workspace root or hands it back for a read-only preview.
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: "Invalid export request" },
        { status: 400 },
      );
    }
    throw error;
  }
  const exportRequest = parseExportRequest(body);
  if (!exportRequest) {
    return NextResponse.json(
      { error: "Invalid export request" },
      { status: 400 },
    );
  }
  if (!exportRequest.openWithoutSaving && exportRequest.filename === "") {
    return NextResponse.json(
      { error: "Filename is required" },
      { status: 400 },
    );
  }

  let source: SessionExportSource;
  try {
    source = await loadSessionForExport({
      userId: session.user.id,
      workspaceId: exportRequest.workspaceId,
      sessionId: exportRequest.sessionId,
    });
  } catch (error) {
    return loadFailureResponse(error);
  }

  const markdown = formatTranscript(source.session, source.messages, {
    thinking: exportRequest.thinking,
    toolDetails: exportRequest.toolDetails,
    assistantMetadata: exportRequest.assistantMetadata,
    providers: source.providers,
  });

  if (exportRequest.openWithoutSaving) {
    const sizeBytes = Buffer.byteLength(markdown, "utf8");
    if (sizeBytes > MAX_PREVIEW_BYTES) {
      return NextResponse.json(
        {
          error: "Transcript too large to preview",
          detail: `${(sizeBytes / 1024 / 1024).toFixed(1)}MB, max ${MAX_PREVIEW_BYTES / 1024 / 1024}MB. Export it to a file instead.`,
        },
        { status: 413 },
      );
    }
    return NextResponse.json({ markdown });
  }

  try {
    await getBackend(source.workspace).writeFile(
      exportRequest.filename,
      markdown,
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to write file";
    const status = message === "Path traversal denied" ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
  return NextResponse.json({ path: exportRequest.filename });
}
