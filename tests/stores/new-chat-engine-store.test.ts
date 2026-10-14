import { beforeEach, describe, expect, it } from "vitest";
import {
  getNewChatEngineChoice,
  useNewChatEngineStore,
} from "@/stores/new-chat-engine-store";

beforeEach(() => {
  useNewChatEngineStore.setState({ engineByWorkspace: {} });
});

describe("new chat engine store", () => {
  it("has no choice until one is picked, so the server default applies", () => {
    expect(getNewChatEngineChoice("ws-1")).toBeUndefined();
  });

  it("remembers the latest pick for each workspace separately", () => {
    const { setNewChatEngine } = useNewChatEngineStore.getState();

    setNewChatEngine("ws-1", "omo");
    setNewChatEngine("ws-2", "omo");
    setNewChatEngine("ws-1", "opencode");

    expect(getNewChatEngineChoice("ws-1")).toBe("opencode");
    expect(getNewChatEngineChoice("ws-2")).toBe("omo");
  });
});
