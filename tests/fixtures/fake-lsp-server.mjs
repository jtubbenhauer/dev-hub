import { appendFileSync } from "node:fs";

const isIgnoringShutdown = process.env.FAKE_LSP_IGNORE_SHUTDOWN === "1";
if (isIgnoringShutdown) process.on("SIGTERM", () => {});

function send(message) {
  const body = JSON.stringify({ jsonrpc: "2.0", ...message });
  process.stdout.write(
    `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
  );
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
