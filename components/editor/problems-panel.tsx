"use client";

import { useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  CircleX,
  TriangleAlert,
  Info,
  Lightbulb,
} from "lucide-react";
import { useDiagnosticsStore } from "@/stores/diagnostics-store";
import { DiagnosticSeverity } from "@/types/diagnostics";
import type { Diagnostic } from "@/types/diagnostics";

interface ProblemsPanelProps {
  workspaceId: string | undefined;
  filePath: string | undefined;
  onNavigate: (line: number, column: number) => void;
}

function SeverityIcon({ severity }: { severity: DiagnosticSeverity }) {
  switch (severity) {
    case DiagnosticSeverity.Error:
      return <CircleX className="text-destructive size-3.5 shrink-0" />;
    case DiagnosticSeverity.Warning:
      return <TriangleAlert className="size-3.5 shrink-0 text-yellow-500" />;
    case DiagnosticSeverity.Information:
      return <Info className="size-3.5 shrink-0 text-blue-400" />;
    case DiagnosticSeverity.Hint:
      return <Lightbulb className="text-muted-foreground size-3.5 shrink-0" />;
  }
}

function formatSource(diagnostic: Diagnostic): string {
  if (!diagnostic.source) return "";
  if (diagnostic.code !== undefined && diagnostic.code !== null) {
    return `${diagnostic.source}(${diagnostic.code})`;
  }
  return diagnostic.source;
}

function DiagnosticItem({
  diagnostic,
  onNavigate,
}: {
  diagnostic: Diagnostic;
  onNavigate: (line: number, column: number) => void;
}) {
  const sourceLabel = formatSource(diagnostic);
  const { startLine, startColumn } = diagnostic.range;

  return (
    <div
      role="button"
      tabIndex={0}
      className="hover:bg-muted/50 flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm"
      onClick={() => onNavigate(startLine, startColumn)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          onNavigate(startLine, startColumn);
        }
      }}
    >
      <SeverityIcon severity={diagnostic.severity} />
      <span className="min-w-0 flex-1 truncate">{diagnostic.message}</span>
      {sourceLabel && (
        <span className="text-muted-foreground shrink-0 text-xs">
          {sourceLabel}
        </span>
      )}
      <span className="text-muted-foreground shrink-0 text-xs">
        {startLine}:{startColumn}
      </span>
    </div>
  );
}

export function ProblemsPanel({
  workspaceId,
  filePath,
  onNavigate,
}: ProblemsPanelProps) {
  const [userCollapsed, setUserCollapsed] = useState(false);

  const diagnostics = useDiagnosticsStore((s) =>
    workspaceId && filePath
      ? (s.diagnosticsByFile.get(`${workspaceId}:${filePath}`) ?? [])
      : [],
  );

  const errorCount = diagnostics.filter(
    (d) => d.severity === DiagnosticSeverity.Error,
  ).length;
  const warningCount = diagnostics.filter(
    (d) => d.severity === DiagnosticSeverity.Warning,
  ).length;

  const isExpanded = errorCount > 0 ? !userCollapsed : userCollapsed;

  const handleToggle = () => {
    setUserCollapsed((prev) => !prev);
  };

  return (
    <div className="flex flex-col border-t">
      <button
        type="button"
        className="hover:bg-muted/50 flex h-8 w-full items-center gap-2 px-3 text-xs"
        onClick={handleToggle}
        aria-expanded={isExpanded}
      >
        {isExpanded ? (
          <ChevronUp className="text-muted-foreground size-3.5 shrink-0" />
        ) : (
          <ChevronDown className="text-muted-foreground size-3.5 shrink-0" />
        )}
        <span className="font-medium">Problems</span>

        {errorCount > 0 && (
          <span className="text-destructive flex items-center gap-1 rounded px-1 py-0.5 text-xs">
            <CircleX className="size-3" />
            {errorCount}
          </span>
        )}
        {warningCount > 0 && (
          <span className="flex items-center gap-1 rounded px-1 py-0.5 text-xs text-yellow-500">
            <TriangleAlert className="size-3" />
            {warningCount}
          </span>
        )}
        {errorCount === 0 && warningCount === 0 && (
          <span className="text-muted-foreground">No problems</span>
        )}
      </button>

      {isExpanded && (
        <div className="max-h-[200px] overflow-y-auto">
          {diagnostics.length === 0 ? (
            <p className="text-muted-foreground px-3 py-4 text-center text-sm">
              No problems detected
            </p>
          ) : (
            diagnostics.map((diagnostic, index) => (
              <DiagnosticItem
                key={index}
                diagnostic={diagnostic}
                onNavigate={onNavigate}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}
