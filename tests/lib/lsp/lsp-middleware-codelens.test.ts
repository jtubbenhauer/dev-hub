import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CancellationToken,
  CodeLens,
  Command,
  Range,
  TextDocument,
} from "vscode";
import type {
  Location as ProtocolLocation,
  Position as ProtocolPosition,
} from "vscode-languageclient/browser.js";
import { buildLspMiddleware } from "@/lib/lsp/client/lsp-middleware";

// Middleware only reads the start line of a lens range.
const lensRange = { start: { line: 0, character: 16 } } as unknown as Range;
const document = {
  uri: "file:///Workspace/src/b.ts",
} as unknown as TextDocument;

class MockUri {
  constructor(readonly value: string) {}
}
class MockPosition {
  constructor(
    readonly line: number,
    readonly character: number,
  ) {}
}
class MockLocation {
  constructor(
    readonly uri: unknown,
    readonly range: unknown,
  ) {}
}
class FakeProtocolCodeLens {
  readonly range = lensRange;
  readonly isResolved = true;
  readonly data = { id: 7 };
  constructor(public command: Command) {}
}

const converter = {
  asUri: vi.fn((value: string) => new MockUri(value)),
  asPosition: vi.fn(
    (value: ProtocolPosition) => new MockPosition(value.line, value.character),
  ),
  asLocation: vi.fn(
    (value: ProtocolLocation) =>
      new MockLocation(new MockUri(value.uri), value.range),
  ),
};
const middleware = buildLspMiddleware({
  getClient: () => ({ protocol2CodeConverter: converter }),
  vscodeTypes: { Position: MockPosition, Location: MockLocation },
});
const token: CancellationToken = {
  isCancellationRequested: false,
  onCancellationRequested: vi.fn(),
};

const fileUri = "file:///Workspace/src/b.ts";
const otherUri = "file:///Workspace/src/refs.ts";
const protocolPosition = { line: 0, character: 16 };
const protocolRange = {
  start: { line: 1, character: 19 },
  end: { line: 1, character: 25 },
};
const protocolLocations = [
  { uri: otherUri, range: protocolRange },
  { uri: fileUri, range: protocolRange },
];

function showReferences(args: unknown[]): Command {
  return {
    title: "2 references",
    command: "editor.action.showReferences",
    arguments: args,
  };
}
function lensWith(command?: Command): CodeLens {
  return command
    ? { range: lensRange, isResolved: true, command }
    : { range: lensRange, isResolved: false };
}
function provide(lenses: CodeLens[] | null | undefined) {
  return middleware.provideCodeLenses?.(document, token, () => lenses);
}
function expectConverterUnused() {
  expect(converter.asUri).not.toHaveBeenCalled();
  expect(converter.asPosition).not.toHaveBeenCalled();
  expect(converter.asLocation).not.toHaveBeenCalled();
}

beforeEach(() => vi.clearAllMocks());

describe("LSP code-lens middleware", () => {
  it("converts raw protocol showReferences arguments", async () => {
    const lens = lensWith(
      showReferences([fileUri, protocolPosition, protocolLocations]),
    );

    const result = await provide([lens]);

    expect(converter.asUri).toHaveBeenCalledExactlyOnceWith(fileUri);
    expect(converter.asPosition).toHaveBeenCalledExactlyOnceWith(
      protocolPosition,
    );
    expect(converter.asLocation.mock.calls).toEqual([
      [protocolLocations[0]],
      [protocolLocations[1]],
    ]);
    expect(result?.[0].command?.arguments).toEqual([
      new MockUri(fileUri),
      new MockPosition(0, 16),
      [
        new MockLocation(new MockUri(otherUri), protocolRange),
        new MockLocation(new MockUri(fileUri), protocolRange),
      ],
    ]);
    expect(result?.[0].command?.title).toBe("2 references");
  });

  it("leaves already-converted arguments untouched without calling the converter", async () => {
    const convertedArguments = [
      new MockUri(fileUri),
      new MockPosition(0, 16),
      [new MockLocation(otherUri, protocolRange)],
    ];
    const command = showReferences(convertedArguments);
    const lens = lensWith(command);

    const result = await provide([lens]);

    expectConverterUnused();
    expect(result?.[0].command).toBe(command);
    expect(result?.[0].command?.arguments).toBe(convertedArguments);
  });

  it("is idempotent when a converted lens is normalised again", async () => {
    const lens = lensWith(
      showReferences([fileUri, protocolPosition, protocolLocations]),
    );
    const [converted] = (await provide([lens])) ?? [];
    const firstCommand = converted.command;
    vi.clearAllMocks();

    const [again] = (await provide([converted])) ?? [];

    expectConverterUnused();
    expect(again.command).toBe(firstCommand);
  });

  it("leaves other commands untouched", async () => {
    const command = {
      title: "Run",
      command: "typescript.other",
      arguments: [fileUri, protocolPosition, protocolLocations],
    };

    const result = await provide([lensWith(command)]);

    expectConverterUnused();
    expect(result?.[0].command).toBe(command);
  });

  it("converts only showReferences lenses in a mixed array and keeps lenses without commands", async () => {
    const other = {
      title: "Other",
      command: "typescript.other",
      arguments: [fileUri],
    };
    const lenses = [
      lensWith(),
      lensWith(other),
      lensWith(showReferences([fileUri, protocolPosition, []])),
    ];

    const result = await provide(lenses);

    expect(result).toHaveLength(3);
    expect(result?.[0].command).toBeUndefined();
    expect(result?.[1].command).toBe(other);
    expect(result?.[2].command?.arguments).toEqual([
      new MockUri(fileUri),
      new MockPosition(0, 16),
      [],
    ]);
    expect(converter.asUri).toHaveBeenCalledExactlyOnceWith(fileUri);
  });

  it("keeps the provided lens object so resolve data survives", async () => {
    const lens = new FakeProtocolCodeLens(
      showReferences([fileUri, protocolPosition, protocolLocations]),
    );

    const result = await provide([lens]);

    expect(result?.[0]).toBe(lens);
    expect(result?.[0]).toBeInstanceOf(FakeProtocolCodeLens);
    expect(lens.data).toEqual({ id: 7 });
    expect(lens.command.arguments?.[0]).toEqual(new MockUri(fileUri));
  });

  it("converts showReferences arguments returned by resolveCodeLens", async () => {
    const unresolved = lensWith();
    const resolved = lensWith(
      showReferences([fileUri, protocolPosition, protocolLocations]),
    );
    const next = vi.fn().mockResolvedValue(resolved);

    const result = await middleware.resolveCodeLens?.(unresolved, token, next);

    expect(next).toHaveBeenCalledWith(unresolved, token);
    expect(result).toBe(resolved);
    expect(result?.command?.arguments?.[1]).toEqual(new MockPosition(0, 16));
    expect(converter.asLocation).toHaveBeenCalledTimes(2);
  });

  it.each([null, undefined])("preserves empty results %j", async (empty) => {
    expect(await provide(empty)).toBe(empty);
    expect(
      await middleware.resolveCodeLens?.(lensWith(), token, () => empty),
    ).toBe(empty);
    expectConverterUnused();
  });

  describe("lenses that vtsls resolves without a command", () => {
    // Each session builds its own middleware, so learned provider ids start empty.
    let sessionMiddleware: ReturnType<typeof buildLspMiddleware>;
    beforeEach(() => {
      sessionMiddleware = buildLspMiddleware({
        getClient: () => ({ protocol2CodeConverter: converter }),
        vscodeTypes: { Position: MockPosition, Location: MockLocation },
      });
    });

    function vtslsLens(providerId: number, line: number): CodeLens {
      return {
        range: { start: { line, character: 2 } } as unknown as Range,
        isResolved: false,
        data: { id: providerId, isResolved: false },
      } as CodeLens;
    }
    function provideLenses(lenses: CodeLens[]) {
      return sessionMiddleware.provideCodeLenses?.(
        document,
        token,
        () => lenses,
      );
    }
    // The client converts every server answer into a new lens object.
    function resolveWithServerAnswer(lens: CodeLens) {
      const answer = vtslsLens(
        (lens as CodeLens & { data: { id: number } }).data.id,
        lens.range.start.line,
      );
      return sessionMiddleware.resolveCodeLens?.(lens, token, () => answer);
    }

    it("labels a lens alone on its line as 0 references with a non-clickable command", async () => {
      const lonely = vtslsLens(3, 0);
      await provideLenses([lonely]);

      const result = await resolveWithServerAnswer(lonely);

      expect(result?.command).toEqual({ title: "0 references", command: "" });
      expect(result).toMatchObject({ data: { id: 3, isResolved: false } });
    });

    it("labels the other provider's lens on a shared line as 0 implementations", async () => {
      const lonelyReferences = vtslsLens(3, 0);
      const sharedImplementations = vtslsLens(4, 5);
      const sharedReferences = vtslsLens(3, 5);
      await provideLenses([
        lonelyReferences,
        sharedImplementations,
        sharedReferences,
      ]);

      const implementations = await resolveWithServerAnswer(
        sharedImplementations,
      );
      const references = await resolveWithServerAnswer(sharedReferences);

      expect(implementations?.command?.title).toBe("0 implementations");
      expect(references?.command?.title).toBe("0 references");
    });

    it("remembers the references provider across documents", async () => {
      await provideLenses([vtslsLens(3, 0)]);
      const sharedImplementations = vtslsLens(4, 5);
      await provideLenses([sharedImplementations, vtslsLens(3, 5)]);

      const result = await resolveWithServerAnswer(sharedImplementations);

      expect(result?.command?.title).toBe("0 implementations");
    });

    it("leaves the lens without a command while the provider kind is unknown", async () => {
      const sharedImplementations = vtslsLens(14, 5);
      await provideLenses([sharedImplementations, vtslsLens(13, 5)]);

      const result = await resolveWithServerAnswer(sharedImplementations);

      expect(result?.command).toBeUndefined();
    });

    it("does not label the requested lens when the client hands it back unresolved", async () => {
      const lonely = vtslsLens(3, 0);
      await provideLenses([lonely]);

      const result = await sessionMiddleware.resolveCodeLens?.(
        lonely,
        token,
        () => lonely,
      );

      expect(result).toBe(lonely);
      expect(lonely.command).toBeUndefined();
    });
  });
});
