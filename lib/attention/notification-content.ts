import { createChatHref } from "@/lib/chat-url-state";
import type { BrowserNotificationContent } from "@/lib/notifications";
import type { PermissionRequest, QuestionRequest } from "@/lib/opencode/types";

export const NOTIFICATION_BODY_MAX_LENGTH = 180;
export const NOTIFICATION_PATTERN_MAX_LENGTH = 60;
export const UNTITLED_SESSION_LABEL = "Untitled session";
export const UNKNOWN_WORKSPACE_LABEL = "Workspace";

const MAX_DISPLAYED_PATTERNS = 3;
const DEFAULT_QUESTION_TEXT = "The agent has a question for you";
const DEFAULT_ERROR_MESSAGE = "An error occurred.";

interface SharedNotificationInput {
  readonly workspaceId: string;
  readonly workspaceName: string | null;
  readonly rootSessionId: string;
  readonly rootTitle: string | null;
}

interface PermissionNotificationInput extends SharedNotificationInput {
  readonly permission: PermissionRequest;
  readonly requesterTitle: string | null;
}

interface QuestionNotificationInput extends SharedNotificationInput {
  readonly question: QuestionRequest;
  readonly requesterTitle: string | null;
}

interface ErrorNotificationInput {
  readonly workspaceId: string;
  readonly workspaceName: string | null;
  readonly rootSessionId: string | null;
  readonly rootTitle: string | null;
  readonly message: string | null;
}

export function truncateNotificationText(
  text: string,
  maxLength: number,
): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= maxLength) return collapsed;
  return `${collapsed.slice(0, maxLength - 1)}…`;
}

function titleOrUntitled(rootTitle: string | null): string {
  const trimmed = rootTitle?.trim();
  return trimmed ? trimmed : UNTITLED_SESSION_LABEL;
}

function workspaceNameOrFallback(workspaceName: string | null): string {
  const trimmed = workspaceName?.trim();
  return trimmed ? trimmed : UNKNOWN_WORKSPACE_LABEL;
}

function buildBody(workspaceName: string | null, detail: string): string {
  return truncateNotificationText(
    `${workspaceNameOrFallback(workspaceName)} · ${detail}`,
    NOTIFICATION_BODY_MAX_LENGTH,
  );
}

export function buildFinishedNotification(
  input: SharedNotificationInput,
): BrowserNotificationContent {
  return {
    title: `${titleOrUntitled(input.rootTitle)} finished`,
    body: buildBody(input.workspaceName, "Ready for your next message"),
    tag: `devhub-finished-${input.rootSessionId}`,
    targetHref: createChatHref({
      workspaceId: input.workspaceId,
      sessionId: input.rootSessionId,
    }),
  };
}

function describePermission(permission: PermissionRequest): string {
  const { patterns } = permission;
  if (patterns.length === 0) return permission.permission;
  const shownPatterns = patterns
    .slice(0, MAX_DISPLAYED_PATTERNS)
    .map((pattern) =>
      truncateNotificationText(pattern, NOTIFICATION_PATTERN_MAX_LENGTH),
    )
    .join(", ");
  const hiddenCount = patterns.length - MAX_DISPLAYED_PATTERNS;
  const hiddenSuffix = hiddenCount > 0 ? ` (+${hiddenCount} more)` : "";
  return `${permission.permission}: ${shownPatterns}${hiddenSuffix}`;
}

export function buildPermissionNotification(
  input: PermissionNotificationInput,
): BrowserNotificationContent {
  const requesterTitle = input.requesterTitle?.trim();
  const requester = requesterTitle ? `Subagent "${requesterTitle}"` : "Agent";
  return {
    title: `Approval needed: ${titleOrUntitled(input.rootTitle)}`,
    body: buildBody(
      input.workspaceName,
      `${requester} wants ${describePermission(input.permission)}`,
    ),
    tag: `devhub-permission-${input.permission.id}`,
    targetHref: createChatHref({
      workspaceId: input.workspaceId,
      sessionId: input.rootSessionId,
    }),
  };
}

function describeQuestion(question: QuestionRequest): string {
  const firstQuestion = question.questions[0];
  const questionText = firstQuestion?.question?.trim();
  if (questionText) return questionText;
  const headerText = firstQuestion?.header?.trim();
  if (headerText) return headerText;
  return DEFAULT_QUESTION_TEXT;
}

export function buildQuestionNotification(
  input: QuestionNotificationInput,
): BrowserNotificationContent {
  const requesterTitle = input.requesterTitle?.trim();
  const prefix = requesterTitle ? `Subagent "${requesterTitle}": ` : "";
  return {
    title: `Question from ${titleOrUntitled(input.rootTitle)}`,
    body: buildBody(
      input.workspaceName,
      `${prefix}${describeQuestion(input.question)}`,
    ),
    tag: `devhub-question-${input.question.id}`,
    targetHref: createChatHref({
      workspaceId: input.workspaceId,
      sessionId: input.rootSessionId,
    }),
  };
}

export function buildErrorNotification(
  input: ErrorNotificationInput,
): BrowserNotificationContent {
  const hasSession = input.rootSessionId !== null;
  const titleSubject = hasSession
    ? titleOrUntitled(input.rootTitle)
    : workspaceNameOrFallback(input.workspaceName);
  return {
    title: `Error in ${titleSubject}`,
    body: buildBody(
      input.workspaceName,
      input.message?.trim() || DEFAULT_ERROR_MESSAGE,
    ),
    tag: input.rootSessionId
      ? `devhub-error-${input.rootSessionId}`
      : `devhub-error-workspace-${input.workspaceId}`,
    targetHref: createChatHref({
      workspaceId: input.workspaceId,
      sessionId: input.rootSessionId,
    }),
  };
}
