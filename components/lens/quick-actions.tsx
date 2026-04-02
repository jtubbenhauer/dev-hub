"use client";

import { memo } from "react";
import { Briefcase, CalendarClock, Radio, FileBarChart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface QuickAction {
  label: string;
  prompt: string;
  icon: React.ElementType;
}

const quickActions: QuickAction[] = [
  {
    label: "Brief me",
    prompt:
      "What am I currently working on across all workspaces? Give me a quick status update.",
    icon: Briefcase,
  },
  {
    label: "Yesterday's work",
    prompt:
      "Summarize what I worked on yesterday across all workspaces. Include session titles and key activities.",
    icon: CalendarClock,
  },
  {
    label: "Active sessions",
    prompt:
      "List all active or busy sessions across all workspaces. What is each one doing right now?",
    icon: Radio,
  },
  {
    label: "Status report",
    prompt:
      "Give me a status report on all workspaces. Include linked tasks, recent session activity, and any blocked work.",
    icon: FileBarChart,
  },
];

interface QuickActionsProps {
  onAction: (prompt: string) => void;
  disabled?: boolean;
  layout?: "wrap" | "stack";
}

export const QuickActions = memo(function QuickActions({
  onAction,
  disabled,
  layout = "wrap",
}: QuickActionsProps) {
  return (
    <div
      className={cn("flex gap-2", layout === "wrap" ? "flex-wrap" : "flex-col")}
    >
      {quickActions.map((action) => (
        <Button
          key={action.label}
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => onAction(action.prompt)}
          className={cn("gap-1.5", layout === "stack" && "justify-start")}
        >
          <action.icon className="size-3.5" />
          {action.label}
        </Button>
      ))}
    </div>
  );
});
