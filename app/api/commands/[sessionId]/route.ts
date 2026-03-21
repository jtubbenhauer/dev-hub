import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { getProcess, removeProcess } from "@/lib/commands/process-manager";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { sessionId } = await params;
  if (!sessionId) {
    return NextResponse.json(
      { error: "sessionId is required" },
      { status: 400 },
    );
  }

  const managed = getProcess(sessionId);
  if (!managed) {
    // Already gone — treat as success
    return NextResponse.json({ removed: true, sessionId });
  }

  if (!managed.exited) {
    return NextResponse.json(
      { error: "Process is still running. Kill it before removing." },
      { status: 409 },
    );
  }

  removeProcess(sessionId);
  return NextResponse.json({ removed: true, sessionId });
}
