import { describe, expect, it } from "vitest";
import {
  DEFAULT_CHAT_FILE_OPEN_MODE,
  resolveChatFileOpenMode,
} from "@/hooks/use-settings";

describe("resolveChatFileOpenMode", () => {
  it("defaults to the sidebar when no preference has been saved", () => {
    expect(resolveChatFileOpenMode(undefined)).toBe(
      DEFAULT_CHAT_FILE_OPEN_MODE,
    );
    expect(DEFAULT_CHAT_FILE_OPEN_MODE).toBe("sidebar");
  });

  it("returns dialog only for the persisted dialog preference", () => {
    expect(resolveChatFileOpenMode("dialog")).toBe("dialog");
    expect(resolveChatFileOpenMode("invalid")).toBe("sidebar");
  });
});
