export class LspSocketOpenError extends Error {
  constructor(readonly reason: "timeout" | "closed" | "error") {
    super(
      reason === "timeout"
        ? "LSP socket open timed out after 10000ms"
        : `LSP socket ${reason} before open`,
    );
    this.name = "LspSocketOpenError";
  }
}

export function waitForLspSocketOpen(webSocket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      webSocket.removeEventListener("open", onOpen);
      webSocket.removeEventListener("close", onClose);
      webSocket.removeEventListener("error", onError);
    };
    const onOpen = () => {
      cleanup();
      resolve();
    };
    const fail = (reason: LspSocketOpenError["reason"]) => {
      cleanup();
      reject(new LspSocketOpenError(reason));
    };
    const onClose = () => fail("closed");
    const onError = () => fail("error");
    const timer = setTimeout(() => fail("timeout"), 10_000);
    webSocket.addEventListener("open", onOpen);
    webSocket.addEventListener("close", onClose);
    webSocket.addEventListener("error", onError);
  });
}
