import { spawn } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";

if (process.env.FAKE_LSP_PID_FILE) {
  writeFileSync(process.env.FAKE_LSP_PID_FILE, String(process.pid));
}
if (process.env.FAKE_LSP_SPAWN_GRANDCHILD === "1") {
  const grandchild = spawn(
    process.execPath,
    ["-e", "setInterval(() => {}, 1000)", "fake-tsserver"],
    { stdio: "ignore" },
  );
  if (process.env.FAKE_LSP_GRANDCHILD_PID_FILE) {
    writeFileSync(
      process.env.FAKE_LSP_GRANDCHILD_PID_FILE,
      String(grandchild.pid),
    );
  }
}

const isIgnoringShutdown = process.env.FAKE_LSP_IGNORE_SHUTDOWN === "1";
if (isIgnoringShutdown) process.on("SIGTERM", () => {});

function send(message) {
  const body = JSON.stringify({ jsonrpc: "2.0", ...message });
  process.stdout.write(
    `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
  );
}

function replaceHelper(line, character) {
  return {
    range: {
      start: { line, character },
      end: { line, character: character + "helper".length },
    },
    newText: "renamed",
  };
}

function renameEdit(renameUri) {
  const sourceDirectory = renameUri.slice(0, renameUri.lastIndexOf("/"));
  const changes = {
    [`${sourceDirectory}/a.ts`]: [replaceHelper(0, 9), replaceHelper(1, 21)],
    [`${sourceDirectory}/b.ts`]: [replaceHelper(1, 16)],
    [`${sourceDirectory}/refs.ts`]: [
      replaceHelper(0, 9),
      replaceHelper(1, 19),
      replaceHelper(2, 19),
    ],
  };
  if (process.env.FAKE_LSP_RENAME_EDIT !== "delete") return { changes };
  return {
    documentChanges: [
      {
        textDocument: { uri: `${sourceDirectory}/b.ts`, version: null },
        edits: changes[`${sourceDirectory}/b.ts`],
      },
      { kind: "delete", uri: `${sourceDirectory}/refs.ts` },
    ],
  };
}

function receive(message) {
  if (process.env.FAKE_LSP_RECORD_FILE) {
    appendFileSync(
      process.env.FAKE_LSP_RECORD_FILE,
      `${JSON.stringify(message)}\n`,
    );
  }
  switch (message.method) {
    case "initialize":
      send({
        id: message.id,
        result: {
          capabilities: {
            textDocumentSync: 2,
            hoverProvider: true,
            referencesProvider: true,
            completionProvider: { resolveProvider: true },
          },
        },
      });
      break;
    case "textDocument/hover":
      if (process.env.FAKE_LSP_EXIT_ON_HOVER === "1") process.exit(3);
      send({ id: message.id, result: { contents: "fake-hover" } });
      break;
    case "textDocument/rename":
      if (process.env.FAKE_LSP_RENAME_EDIT) {
        send({
          id: message.id,
          result: renameEdit(message.params.textDocument.uri),
        });
      }
      break;
    case "shutdown":
      if (!isIgnoringShutdown) send({ id: message.id, result: null });
      break;
    case "exit":
      if (!isIgnoringShutdown) process.exit(0);
      break;
    case "initialized":
      if (process.env.FAKE_LSP_ASK_CONFIG === "1") {
        send({
          id: "cfg-1",
          method: "workspace/configuration",
          params: { items: [{ section: "typescript.inlayHints" }] },
        });
      }
      break;
  }
}

let buffer = Buffer.alloc(0);
process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) return;
    const header = buffer.subarray(0, headerEnd).toString("ascii");
    const match = /Content-Length:\s*(\d+)/i.exec(header);
    if (!match) throw new Error("Missing Content-Length");
    const bodyStart = headerEnd + 4;
    const bodyEnd = bodyStart + Number(match[1]);
    if (buffer.length < bodyEnd) return;
    const body = buffer.subarray(bodyStart, bodyEnd).toString("utf8");
    buffer = buffer.subarray(bodyEnd);
    receive(JSON.parse(body));
  }
});
