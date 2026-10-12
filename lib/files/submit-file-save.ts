import type { buildFileSaveBody } from "@/lib/files/save-request";

export async function submitFileSave(
  body: ReturnType<typeof buildFileSaveBody>,
): Promise<void> {
  const response = await fetch("/api/files/content", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const data: unknown = await response.json();
    throw new Error(
      typeof data === "object" &&
        data !== null &&
        "error" in data &&
        typeof data.error === "string"
        ? data.error
        : "Failed to save file",
    );
  }
}
