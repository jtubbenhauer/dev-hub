import type { JsonlRecord } from "@/lib/omo/jsonl";
import type {
  SessionBackgroundStatus,
  SessionGoalState,
} from "@/lib/opencode/types";

export type OmoBackgroundStatusKey = "goal" | "goal-wait" | "monitors";

export interface OmoBackgroundStatusUpdate {
  readonly key: OmoBackgroundStatusKey;
  readonly text: string | undefined;
}

const BACKGROUND_STATUS_KEYS = new Set<string>([
  "goal",
  "goal-wait",
  "monitors",
]);

// omo writes these lines for a terminal footer: the wait line starts with a
// ▰▱ progress bar and the monitor line with a ◉ glyph.
const WAIT_PROGRESS_BAR = /^([▰▱]+)\s*/u;
const WAIT_CHECK_IN = /^goal (?:continues|resumes) in (.+?)(?: · |$)/u;
const WATCH_GLYPH = /^◉\s*/u;
const SEVERAL_MONITORS = /^watching (\d+): /u;
const GOAL_STATE_PATTERNS: ReadonlyArray<readonly [SessionGoalState, RegExp]> =
  [
    ["active", /^Pursuing goal\b/u],
    ["paused", /^Goal paused\b/u],
    ["stopped", /^Goal stopped\b/u],
    ["blocked", /^Goal blocked\b/u],
    ["achieved", /(?:^|\s)· Goal achieved(?: \([^)]*\))?$/u],
  ];

function isBackgroundStatusKey(
  value: unknown,
): value is OmoBackgroundStatusKey {
  return typeof value === "string" && BACKGROUND_STATUS_KEYS.has(value);
}

export function readBackgroundStatusUpdate(
  record: JsonlRecord,
): OmoBackgroundStatusUpdate | undefined {
  const key = record.statusKey;
  if (
    record.type !== "extension_ui_request" ||
    record.method !== "setStatus" ||
    !isBackgroundStatusKey(key)
  ) {
    return undefined;
  }
  const text =
    typeof record.statusText === "string" ? record.statusText.trim() : "";
  return { key, text: text === "" ? undefined : text };
}

function goalWaitFields(
  text: string,
): Pick<
  SessionBackgroundStatus,
  "goalWait" | "goalCheckIn" | "goalWaitProgress"
> {
  const bar = WAIT_PROGRESS_BAR.exec(text);
  const goalWait = bar === null ? text : text.slice(bar[0].length);
  const cells = [...(bar?.[1] ?? "")];
  const checkIn = WAIT_CHECK_IN.exec(goalWait)?.[1];
  return {
    goalWait,
    ...(checkIn === undefined ? {} : { goalCheckIn: checkIn }),
    ...(cells.length === 0
      ? {}
      : {
          goalWaitProgress:
            cells.filter((cell) => cell === "▰").length / cells.length,
        }),
  };
}

function goalFields(
  goal: string,
): Pick<SessionBackgroundStatus, "goal" | "goalState"> {
  const goalState = GOAL_STATE_PATTERNS.find(([, pattern]) =>
    pattern.test(goal),
  )?.[0];
  return { goal, ...(goalState === undefined ? {} : { goalState }) };
}

function monitorFields(
  text: string,
): Pick<SessionBackgroundStatus, "monitors" | "monitorCount"> {
  const monitors = text.replace(WATCH_GLYPH, "");
  const severalCount = SEVERAL_MONITORS.exec(monitors)?.[1];
  return {
    monitors,
    monitorCount: severalCount === undefined ? 1 : Number(severalCount),
  };
}

export function toSessionBackgroundStatus(
  texts: ReadonlyMap<OmoBackgroundStatusKey, string>,
): SessionBackgroundStatus | null {
  const goal = texts.get("goal");
  const goalWait = texts.get("goal-wait");
  const monitors = texts.get("monitors");
  if (goal === undefined && goalWait === undefined && monitors === undefined) {
    return null;
  }
  return {
    ...(goal === undefined ? {} : goalFields(goal)),
    ...(goalWait === undefined ? {} : goalWaitFields(goalWait)),
    ...(monitors === undefined ? {} : monitorFields(monitors)),
  };
}
