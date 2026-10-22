import type { Todo } from "@opencode-ai/sdk";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function todoStatus(value: unknown): Todo["status"] {
  switch (value) {
    case "in_progress":
    case "completed":
      return value;
    case "abandoned":
      return "cancelled";
    default:
      return "pending";
  }
}

// omo stores { phases: [{ name, tasks }] }; null means no todo state at all.
export function todosFromTodoState(state: unknown): Todo[] | null {
  if (!isRecord(state) || !Array.isArray(state.phases)) return null;
  return state.phases.flatMap((phase) => {
    if (!isRecord(phase) || !Array.isArray(phase.tasks)) return [];
    const phaseName = typeof phase.name === "string" ? phase.name : "";
    return phase.tasks.flatMap((task) =>
      isRecord(task) && typeof task.content === "string"
        ? [
            {
              id: `${phaseName}/${task.content}`,
              content: task.content,
              status: todoStatus(task.status),
              priority: "medium",
            },
          ]
        : [],
    );
  });
}
