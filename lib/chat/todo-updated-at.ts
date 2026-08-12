import type { MessageWithParts, Session } from "@/lib/opencode/types";

export function getTodoUpdatedAt(
  messages: readonly MessageWithParts[],
  session: Session | undefined,
): number | undefined {
  const latestTodoCompletion = Math.max(
    0,
    ...messages.flatMap((message) =>
      message.parts.flatMap((part) =>
        part.type === "tool" &&
        part.tool === "todowrite" &&
        part.state.status === "completed"
          ? [part.state.time.end]
          : [],
      ),
    ),
  );

  return latestTodoCompletion || session?.time.updated;
}
