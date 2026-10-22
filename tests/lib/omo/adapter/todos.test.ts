import { describe, expect, it } from "vitest";
import { todosFromTodoState } from "@/lib/omo/adapter/todos";

describe("todosFromTodoState", () => {
  it("flattens omo's phases into sidebar todos in phase order", () => {
    const todos = todosFromTodoState({
      schema: "v2",
      phases: [
        {
          name: "Investigation",
          tasks: [
            { content: "Read the code", status: "completed" },
            { content: "Find the gap", status: "in_progress" },
          ],
        },
        {
          name: "Report",
          tasks: [
            { content: "Write findings", status: "pending" },
            { content: "Old idea", status: "abandoned" },
          ],
        },
      ],
    });

    expect(todos).toEqual([
      {
        id: "Investigation/Read the code",
        content: "Read the code",
        status: "completed",
        priority: "medium",
      },
      {
        id: "Investigation/Find the gap",
        content: "Find the gap",
        status: "in_progress",
        priority: "medium",
      },
      {
        id: "Report/Write findings",
        content: "Write findings",
        status: "pending",
        priority: "medium",
      },
      {
        id: "Report/Old idea",
        content: "Old idea",
        status: "cancelled",
        priority: "medium",
      },
    ]);
  });

  it("skips malformed phases and tasks", () => {
    expect(
      todosFromTodoState({
        phases: [
          null,
          { name: "No tasks" },
          {
            name: "Mixed",
            tasks: [{ status: "pending" }, { content: "Kept" }],
          },
        ],
      }),
    ).toEqual([
      {
        id: "Mixed/Kept",
        content: "Kept",
        status: "pending",
        priority: "medium",
      },
    ]);
  });

  it("returns null when the value carries no todo state", () => {
    expect(todosFromTodoState(undefined)).toBeNull();
    expect(todosFromTodoState({ op: "view" })).toBeNull();
    expect(todosFromTodoState({ phases: [] })).toEqual([]);
  });
});
