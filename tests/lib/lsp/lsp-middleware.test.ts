import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Command } from "vscode";
import {
  mocks,
  document,
  range,
  token,
  actionContext,
  commands,
  expected,
} from "@/tests/lib/lsp/lsp-commands-fixture";
import { buildLspMiddleware } from "@/lib/lsp/client/lsp-middleware";

beforeEach(() => vi.clearAllMocks());

class UnusedVscodeType {}
class FakeProtocolCodeAction {
  readonly title = "Refactor";
  readonly data = { resolveId: 7 };

  constructor(public command: Command) {}
}

const actionCases = [
  ...commands.map((command, index) => ({
    command,
    rewritten: expected[index],
  })),
  ...expected.slice(0, 2).map((command) => ({ command, rewritten: command })),
];

const buildMiddleware = () =>
  buildLspMiddleware({
    getClient: () => undefined,
    vscodeTypes: { Position: UnusedVscodeType, Location: UnusedVscodeType },
  });

describe("LSP code-action middleware", () => {
  it("rewrites both action commands and bare commands when actions are provided", async () => {
    const actions = commands.map((command) => ({
      title: command.title,
      command,
    }));
    const next = vi
      .fn()
      .mockResolvedValue([...actions, ...commands, { title: "No command" }]);
    const result = await buildMiddleware().provideCodeActions?.(
      document,
      range,
      actionContext,
      token,
      next,
    );
    expect(next).toHaveBeenCalledWith(document, range, actionContext, token);
    expect(result).toEqual([
      ...expected.map((command) => ({ title: command.title, command })),
      ...expected,
      { title: "No command" },
    ]);
    expect(mocks.sendRequest).not.toHaveBeenCalled();
  });

  it.each(actionCases)(
    "preserves provided action identity, prototype and data for $command.command",
    async ({ command, rewritten }) => {
      const action = new FakeProtocolCodeAction(command);
      const data = action.data;

      const result = await buildMiddleware().provideCodeActions?.(
        document,
        range,
        actionContext,
        token,
        () => [action],
      );

      expect(result?.[0]).toBeInstanceOf(FakeProtocolCodeAction);
      expect(result?.[0]).toBe(action);
      expect(result?.[0]).toHaveProperty("data", data);
      expect(action.data).toBe(data);
      expect(action.command).toEqual(rewritten);
      if (command.command === rewritten.command) {
        expect(action.command).toBe(command);
      }
    },
  );

  it.each(actionCases)(
    "preserves the resolved action identity, prototype and data for $command.command",
    async ({ command, rewritten }) => {
      const unresolved = { title: "Unresolved" };
      const resolved = new FakeProtocolCodeAction(command);
      const data = resolved.data;
      const next = vi.fn(() => resolved);

      const result = await buildMiddleware().resolveCodeAction?.(
        unresolved,
        token,
        next,
      );

      expect(next).toHaveBeenCalledWith(unresolved, token);
      expect(result).toBeInstanceOf(FakeProtocolCodeAction);
      expect(result).toBe(resolved);
      expect(result).toHaveProperty("data", data);
      expect(resolved.data).toBe(data);
      expect(resolved.command).toEqual(rewritten);
      if (command.command === rewritten.command) {
        expect(resolved.command).toBe(command);
      }
    },
  );

  it.each(actionCases)(
    "preserves bare-command copy and no-op behavior for $command.command",
    async ({ command, rewritten }) => {
      const original = structuredClone(command);

      const result = await buildMiddleware().provideCodeActions?.(
        document,
        range,
        actionContext,
        token,
        () => [command],
      );

      expect(result?.[0]).toEqual(rewritten);
      expect(command).toEqual(original);
      if (command.command === rewritten.command) {
        expect(result?.[0]).toBe(command);
      } else {
        expect(result?.[0]).not.toBe(command);
      }
    },
  );

  it.each(commands.map((command, index) => ({ command, index })))(
    "rewrites $command.command after resolve returns",
    async ({ command, index }) => {
      const item = { title: "Unresolved" };
      const next = vi.fn().mockResolvedValue({ title: "Resolved", command });
      const result = await buildMiddleware().resolveCodeAction?.(
        item,
        token,
        next,
      );
      expect(next).toHaveBeenCalledWith(item, token);
      expect(result).toEqual({ title: "Resolved", command: expected[index] });
      expect(mocks.sendRequest).not.toHaveBeenCalled();
    },
  );

  it.each([null, undefined])(
    "preserves empty provider results %j",
    async (empty) => {
      const middleware = buildMiddleware();
      expect(
        await middleware.provideCodeActions?.(
          document,
          range,
          actionContext,
          token,
          () => empty,
        ),
      ).toBe(empty);
      expect(
        await middleware.resolveCodeAction?.(
          { title: "Empty" },
          token,
          () => empty,
        ),
      ).toBe(empty);
    },
  );
});
