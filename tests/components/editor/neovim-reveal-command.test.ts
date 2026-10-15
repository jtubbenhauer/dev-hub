// @vitest-environment node
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { buildNeovimRevealCommand } from "@/components/editor/neovim-reveal-command";

const request = {
  path: "a.txt",
  lineNumber: 2,
  startByteColumn: 3,
  lineSha256:
    "795c238dcce900c0131e710c25229cc164f8c22b48bb0d5ea3343ad340d91bc4",
};

describe("buildNeovimRevealCommand", () => {
  it("builds the exact guarded command when the request is valid", () => {
    // Given / When
    const command = buildNeovimRevealCommand(request);
    // Then — copied from the plan's verified command.
    expect(command).toBe(
      "if expand('%:p') ==# fnamemodify('a.txt', ':p') && &modified | echohl WarningMsg | echomsg 'dev-hub: a.txt has unsaved changes, so the search match was not selected' | echohl None | else | execute 'edit' fnameescape('a.txt') | if expand('%:p') !=# fnamemodify('a.txt', ':p') | echohl WarningMsg | echomsg 'dev-hub: could not open a.txt for the search result' | echohl None | elseif &modified | echohl WarningMsg | echomsg 'dev-hub: a.txt has unsaved changes, so the search match was not selected' | echohl None | else | edit | if 2 > line('$') || sha256(getline(2)) !=# '795c238dcce900c0131e710c25229cc164f8c22b48bb0d5ea3343ad340d91bc4' | echohl WarningMsg | echomsg 'dev-hub: a.txt changed since the search ran. Search again.' | echohl None | else | call cursor(2, 3) | execute 'normal! zz' | endif | endif | endif",
    );
  });

  it("doubles every quoted path occurrence when the name contains quotes and pipes", () => {
    // Given / When
    const command = buildNeovimRevealCommand({
      ...request,
      path: "it's | odd.txt",
    });
    // Then
    expect(command).toBe(
      buildNeovimRevealCommand(request)?.replaceAll("a.txt", "it''s | odd.txt"),
    );
  });

  it.each([
    { path: "a\nb.txt" },
    { path: "a\x1bb.txt" },
    { path: "a\0b.txt" },
    { path: "a\x7fb.txt" },
    { lineSha256: "a".repeat(63) },
    { lineSha256: "A".repeat(64) },
    { lineNumber: 0 },
    { lineNumber: -1 },
    { lineNumber: Number.NaN },
    { startByteColumn: 1.5 },
    { startByteColumn: 0 },
  ])("rejects malformed request %j", (override) => {
    // Given / When / Then
    expect(buildNeovimRevealCommand({ ...request, ...override })).toBeNull();
  });
});

describe.skipIf(spawnSync("nvim", ["--version"]).status !== 0)(
  "headless Neovim",
  () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nvim-reveal-"));
    afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
    const fixtures = {
      "a.txt": "first\na needle here\n",
      "b.txt": "other\n",
      "c.txt": "first\né needle here\n",
      "d.txt": "first\nold line\n",
      "e.txt": "first\nsecond\n",
      "it's | odd.txt": "first\na needle here\n",
      "crlf.txt": "first\r\na needle here\r\n",
    };
    const scenarios = [
      {
        id: 1,
        setup: ["edit b.txt"],
        target: "a.txt",
        cursor: "[2, 3]",
        modified: "clean",
      },
      {
        id: 2,
        setup: ["edit b.txt", "call setline(1, 'changed')"],
        target: "a.txt",
        cursor: "[2, 3]",
        modified: "clean",
        preserved: "b.txt",
      },
      {
        id: 3,
        setup: [
          "edit a.txt",
          "call setline(1, 'changed first')",
          "call cursor(1, 1)",
        ],
        target: "a.txt",
        cursor: "[1, 1]",
        modified: "modified",
        message:
          "dev-hub: a.txt has unsaved changes, so the search match was not selected",
        preserved: "a.txt",
      },
      {
        id: 4,
        setup: ["set nohidden", "edit b.txt", "call setline(1, 'changed')"],
        target: "a.txt",
        file: "b.txt",
        cursor: "[1, 1]",
        modified: "modified",
        message: "E37",
        preserved: "b.txt",
      },
      {
        id: 5,
        setup: ["edit b.txt"],
        target: "c.txt",
        cursor: "[1, 1]",
        modified: "clean",
        message: "dev-hub: c.txt changed since the search ran. Search again.",
      },
      {
        id: 6,
        setup: [
          "edit d.txt",
          "edit b.txt",
          "call writefile(['first', 'a needle here'], 'd.txt')",
        ],
        target: "d.txt",
        cursor: "[2, 3]",
        modified: "clean",
      },
      {
        id: 7,
        setup: ["edit b.txt"],
        target: "it's | odd.txt",
        cursor: "[2, 3]",
        modified: "clean",
      },
      {
        id: 8,
        setup: ["edit a.txt", "call setline(1, 'changed first')", "edit b.txt"],
        target: "a.txt",
        cursor: "[1, 1]",
        modified: "modified",
        message:
          "dev-hub: a.txt has unsaved changes, so the search match was not selected",
        preserved: "a.txt",
      },
      {
        id: 9,
        setup: ["edit b.txt"],
        target: "crlf.txt",
        cursor: "[2, 3]",
        modified: "clean",
      },
      {
        id: 10,
        setup: ["edit a.txt", "call cursor(1, 1)"],
        target: "a.txt",
        cursor: "[2, 3]",
        modified: "clean",
      },
      {
        id: 11,
        setup: ["edit b.txt"],
        target: "e.txt",
        cursor: "[1, 1]",
        modified: "clean",
        message: "dev-hub: e.txt changed since the search ran. Search again.",
        lineNumber: 5,
        lineSha256:
          "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      },
    ];

    describe.each(["script", "feedkeys"])("%s delivery", (mode) => {
      it.each(scenarios)(
        "preserves buffer safety in scenario $id",
        (scenario) => {
          // Given
          for (const [name, content] of Object.entries(fixtures))
            fs.writeFileSync(path.join(dir, name), content);
          fs.rmSync(path.join(dir, "result.txt"), { force: true });
          const command = buildNeovimRevealCommand({
            ...request,
            path: scenario.target,
            lineNumber: scenario.lineNumber ?? 2,
            lineSha256: scenario.lineSha256 ?? request.lineSha256,
          });
          if (command === null)
            throw new Error("Expected a valid reveal command");
          const run =
            mode === "script"
              ? command
              : `call feedkeys(':' . '${command.replaceAll("'", "''")}' . "\r", 'ntx')`;
          const scriptPath = path.join(dir, "run.vim");
          fs.writeFileSync(
            scriptPath,
            [
              ...scenario.setup,
              run,
              `call writefile([expand('%:t'), string(getpos('.')[1:2]), (&modified ? 'modified' : 'clean')] + split(execute('messages'), "\\n"), 'result.txt')`,
              ...(scenario.preserved
                ? [
                    `call writefile(getbufline('${scenario.preserved}', 1, '$') + [string(getbufvar('${scenario.preserved}', '&modified'))], 'preserved.txt')`,
                  ]
                : []),
              "qa!",
              "",
            ].join("\n"),
          );
          // When
          const result = spawnSync(
            "nvim",
            ["--headless", "--clean", "-n", "-S", scriptPath],
            { cwd: dir, timeout: 15000 },
          );
          // Then
          expect(result.error).toBeUndefined();
          expect(result.signal).toBeNull();
          expect(result.status).toBe(0);
          const [file, cursor, modified, ...messages] = fs
            .readFileSync(path.join(dir, "result.txt"), "utf8")
            .trimEnd()
            .split("\n");
          expect([file, cursor, modified]).toEqual([
            scenario.file ?? scenario.target,
            scenario.cursor,
            scenario.modified,
          ]);
          if (scenario.message)
            expect(messages.join("\n")).toContain(scenario.message);
          if (scenario.preserved) {
            expect(
              fs.readFileSync(path.join(dir, "preserved.txt"), "utf8"),
            ).toBe(
              scenario.preserved === "b.txt"
                ? "changed\n1\n"
                : "changed first\na needle here\n1\n",
            );
          }
        },
      );
    });
  },
);
