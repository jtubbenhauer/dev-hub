import { CircleX, TriangleAlert } from "lucide-react";
import { useDiagnosticsForFile } from "@/hooks/use-diagnostics";

export function FileDiagnosticCounts({
  workspaceId,
  filePath,
}: {
  readonly workspaceId: string | undefined;
  readonly filePath: string | undefined;
}) {
  const { errorCount, warningCount } = useDiagnosticsForFile(
    workspaceId,
    filePath,
  );
  return (
    <>
      {errorCount > 0 && (
        <span className="text-destructive flex items-center gap-1 text-xs">
          <CircleX className="size-3" />
          {errorCount}
        </span>
      )}
      {warningCount > 0 && (
        <span className="flex items-center gap-1 text-xs text-yellow-500">
          <TriangleAlert className="size-3" />
          {warningCount}
        </span>
      )}
    </>
  );
}
