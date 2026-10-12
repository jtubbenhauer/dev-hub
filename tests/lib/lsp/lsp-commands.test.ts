import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  mocks,
  client,
  range,
  context,
  uri,
  position,
  editor,
  run,
  rename,
  commands,
  expected,
} from "@/tests/lib/lsp/lsp-commands-fixture";
import { registerLspClientCommands } from "@/lib/lsp/client/lsp-commands";
import { rewriteLspCommand } from "@/lib/lsp/client/lsp-middleware";
import { LSP_APPLY_EDIT_COMMAND } from "@/lib/lsp/types";

const applied = {
  applied: true,
  reason: null,
  changedUris: [uri],
  createdUris: [],
};
let matchingEditor: ReturnType<typeof editor>;
let otherEditor: ReturnType<typeof editor>;
let monaco: { editor: { getEditors: () => ReturnType<typeof editor>[] } };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.handlers.clear();
  matchingEditor = editor(uri.toLowerCase());
  otherEditor = editor("file:///Workspace/other.ts");
  monaco = { editor: { getEditors: () => [otherEditor, matchingEditor] } };
  mocks.getMonaco.mockReturnValue(monaco);
  mocks.sendRequest.mockResolvedValue(applied);
  mocks.sync.mockResolvedValue();
});

describe("LSP client commands", () => {
  it("registers exactly the four client-owned commands when connected", () => {
    registerLspClientCommands(client, context);
    expect([...mocks.handlers.keys()]).toEqual([
      "devhub.lsp.renameAt",
      "devhub.lsp.applyEdit",
      "_typescript.moveToFileRefactoring",
      "_typescript.didOrganizeImports",
    ]);
  });

  it("ignores the organize-imports notification without edits or server requests", () => {
    registerLspClientCommands(client, context);
    expect(run("_typescript.didOrganizeImports")).toBeUndefined();
    expect(mocks.sendRequest).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.sync).not.toHaveBeenCalled();
    expect(mocks.open).not.toHaveBeenCalled();
    expect(matchingEditor.trigger).not.toHaveBeenCalled();
  });

  it("positions and focuses the matching editor when the URI casing differs", () => {
    registerLspClientCommands(client, context);
    run("devhub.lsp.renameAt", uri, position);
    expect(matchingEditor.setPosition).toHaveBeenCalledWith({
      lineNumber: 3,
      column: 5,
    });
    expect(matchingEditor.focus).toHaveBeenCalledOnce();
    expect(matchingEditor.trigger).toHaveBeenCalledWith(
      "lsp",
      "editor.action.rename",
      null,
    );
    expect(otherEditor.trigger).not.toHaveBeenCalled();
    expect(matchingEditor.setPosition.mock.invocationCallOrder[0]).toBeLessThan(
      matchingEditor.focus.mock.invocationCallOrder[0],
    );
    expect(matchingEditor.focus.mock.invocationCallOrder[0]).toBeLessThan(
      matchingEditor.trigger.mock.invocationCallOrder[0],
    );
  });

  it("does nothing when no editor matches the rename URI", () => {
    registerLspClientCommands(client, context);
    run("devhub.lsp.renameAt", "file:///missing.ts", position);
    expect(matchingEditor.trigger).not.toHaveBeenCalled();
    expect(otherEditor.trigger).not.toHaveBeenCalled();
  });

  it("sends only the edit id to the bridge and synchronizes its result when applied", async () => {
    registerLspClientCommands(client, context);
    await run("devhub.lsp.applyEdit", "edit-1", null);
    expect(mocks.sendRequest).toHaveBeenCalledExactlyOnceWith(
      "workspace/executeCommand",
      {
        command: LSP_APPLY_EDIT_COMMAND,
        arguments: ["edit-1"],
      },
    );
    expect(mocks.sync).toHaveBeenCalledExactlyOnceWith(applied, {
      monaco,
      ...context,
    });
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("waits for reloads before the inline rename follow-up when applied", async () => {
    let finishReload = () => {};
    mocks.sync.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishReload = resolve;
        }),
    );
    registerLspClientCommands(client, context);
    const pending = run("devhub.lsp.applyEdit", "edit-1", rename);
    await vi.waitFor(() => expect(mocks.sync).toHaveBeenCalledOnce());
    expect(matchingEditor.trigger).not.toHaveBeenCalled();
    finishReload();
    await pending;
    expect(matchingEditor.setPosition).toHaveBeenCalledWith({
      lineNumber: 3,
      column: 5,
    });
    expect(matchingEditor.trigger).toHaveBeenCalledOnce();
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it.each([rename, { command: "typescript.other", arguments: [42] }])(
    "skips follow-up $command when the edit is refused",
    async (followUp) => {
      const refused = { ...applied, applied: false, reason: "unsaved changes" };
      mocks.sendRequest.mockResolvedValue(refused);
      registerLspClientCommands(client, context);
      await run("devhub.lsp.applyEdit", "edit-1", followUp);
      expect(mocks.sync).toHaveBeenCalledWith(refused, { monaco, ...context });
      expect(matchingEditor.trigger).not.toHaveBeenCalled();
      expect(mocks.execute).not.toHaveBeenCalled();
    },
  );

  it.each([
    null,
    {},
    { ...applied, changedUris: [1] },
    { ...applied, createdUris: null },
    { ...applied, reason: 3 },
    { ...applied, applied: "yes" },
  ])("refuses an unexpected bridge response %j", async (response) => {
    mocks.sendRequest.mockResolvedValue(response);
    registerLspClientCommands(client, context);
    await run("devhub.lsp.applyEdit", "edit-1", rename);
    expect(mocks.sync).toHaveBeenCalledWith(
      {
        applied: false,
        reason: "unexpected response",
        changedUris: [],
        createdUris: [],
      },
      { monaco, ...context },
    );
    expect(matchingEditor.trigger).not.toHaveBeenCalled();
  });

  it.each([undefined, ["value", 42]])(
    "dispatches other follow-ups with arguments %j when applied",
    async (arguments_) => {
      registerLspClientCommands(client, context);
      await run("devhub.lsp.applyEdit", "edit-1", {
        command: "typescript.other",
        arguments: arguments_,
      });
      expect(mocks.execute).toHaveBeenCalledExactlyOnceWith(
        "typescript.other",
        ...(arguments_ ?? []),
      );
    },
  );

  it("appends the absolute target when the move dialog confirms", async () => {
    mocks.open.mockResolvedValue("/Workspace/src/moved.ts");
    registerLspClientCommands(client, context);
    const action = { name: "Move to file" };
    await run("_typescript.moveToFileRefactoring", action, uri, range);
    expect(mocks.sendRequest).toHaveBeenCalledExactlyOnceWith(
      "workspace/executeCommand",
      {
        command: "_typescript.moveToFileRefactoring",
        arguments: [action, uri, range, "/Workspace/src/moved.ts"],
      },
    );
  });

  it("sends nothing when the move dialog is cancelled", async () => {
    mocks.open.mockResolvedValue(null);
    registerLspClientCommands(client, context);
    await run("_typescript.moveToFileRefactoring", {}, uri, range);
    expect(mocks.sendRequest).not.toHaveBeenCalled();
  });

  it("unregisters every owned command when disposed", () => {
    const registration = registerLspClientCommands(client, context);
    registration.dispose();
    expect(mocks.unregister.mock.calls.flat()).toEqual([
      "devhub.lsp.renameAt",
      "devhub.lsp.applyEdit",
      "_typescript.moveToFileRefactoring",
      "_typescript.didOrganizeImports",
    ]);
  });

  it("cancels the pending replacement move when the session is disposed", async () => {
    let finishFirst = (_path: string | null) => {};
    let finishSecond = (_path: string | null) => {};
    mocks.open
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishFirst = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishFirst(null);
            finishSecond = resolve;
          }),
      );
    mocks.close.mockImplementation(() => finishSecond(null));
    const registration = registerLspClientCommands(client, context);
    const first = run("_typescript.moveToFileRefactoring", {}, uri, range);
    const second = run("_typescript.moveToFileRefactoring", {}, uri, range);
    await first;
    registration.dispose();
    expect(mocks.close).toHaveBeenCalledWith(null);
    await second;
    expect(mocks.sendRequest).not.toHaveBeenCalled();
  });
});

describe("LSP code-action middleware", () => {
  it.each(commands.map((command, index) => ({ command, index })))(
    "rewrites only supported command $command.command without mutation",
    ({ command, index }) => {
      const original = structuredClone(command);
      expect(rewriteLspCommand(command)).toEqual(expected[index]);
      expect(command).toEqual(original);
      if (index === 2) expect(rewriteLspCommand(command)).toBe(command);
    },
  );
});
