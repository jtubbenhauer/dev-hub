export const SESSION_DELETION_FAILED_MESSAGE = "Failed to delete chat";
export const OMO_SESSION_IN_USE_MESSAGE =
  "Session is open in another omo client";

export type SessionDeletionResult =
  | { readonly isDeleted: true }
  | { readonly isDeleted: false; readonly failureMessage: string };

async function readErrorCode(response: Response): Promise<string | null> {
  try {
    const body: unknown = await response.json();
    if (typeof body !== "object" || body === null || !("error" in body)) {
      return null;
    }
    return typeof body.error === "string" ? body.error : null;
  } catch {
    return null;
  }
}

// The omo facade refuses to delete a session that another omo client still
// has attached (409 {error:"session_in_use"}); every other failure keeps the
// generic message.
export async function readSessionDeletionFailureMessage(
  response: Response,
): Promise<string> {
  if (response.status !== 409) return SESSION_DELETION_FAILED_MESSAGE;
  const errorCode = await readErrorCode(response);
  return errorCode === "session_in_use"
    ? OMO_SESSION_IN_USE_MESSAGE
    : SESSION_DELETION_FAILED_MESSAGE;
}
