function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function sessionIdsFromMetadata(metadata: unknown): string[] {
  if (!isRecord(metadata)) return [];
  const ids = Array.isArray(metadata.sessionIds)
    ? metadata.sessionIds.filter((id): id is string => typeof id === "string")
    : [];
  if (
    typeof metadata.sessionId === "string" &&
    !ids.includes(metadata.sessionId)
  ) {
    ids.unshift(metadata.sessionId);
  }
  return ids;
}

export function childSessionIdsForAgentPart(part: {
  readonly state: unknown;
  readonly metadata?: unknown;
}): string[] {
  const stateMetadata = isRecord(part.state) ? part.state.metadata : undefined;
  const fromState = sessionIdsFromMetadata(stateMetadata);
  return fromState.length > 0
    ? fromState
    : sessionIdsFromMetadata(part.metadata);
}

// OpenCode tasks carry `description`; OmO tasks carry `task_summary` or `name`,
// and a parallel OmO call nests one entry per subagent under `tasks`.
export function agentTaskDescription(input: unknown): string | undefined {
  if (!isRecord(input)) return undefined;
  const single =
    nonEmptyText(input.description) ??
    nonEmptyText(input.task_summary) ??
    nonEmptyText(input.name);
  if (single !== undefined) return single;
  if (!Array.isArray(input.tasks)) return undefined;
  const summaries = input.tasks.flatMap((task) => {
    if (!isRecord(task)) return [];
    const summary =
      nonEmptyText(task.description) ??
      nonEmptyText(task.task_summary) ??
      nonEmptyText(task.name);
    return summary === undefined ? [] : [summary];
  });
  if (summaries.length === 0) return `${input.tasks.length} tasks`;
  if (summaries.length === 1) return summaries[0];
  return `${summaries.length} tasks: ${summaries.join("; ")}`;
}
