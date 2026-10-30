import { Terminal as HeadlessTerminal } from "@xterm/headless";
import { SerializeAddon } from "@xterm/addon-serialize";

export class TerminalMirror {
  private readonly terminal: HeadlessTerminal;
  private readonly serializer: SerializeAddon;

  constructor(cols: number, rows: number, scrollback: number) {
    this.terminal = new HeadlessTerminal({
      cols,
      rows,
      scrollback,
      allowProposedApi: true,
    });
    this.serializer = new SerializeAddon();
    this.terminal.loadAddon(this.serializer);
  }

  write(data: string): void {
    this.terminal.write(data);
  }

  resize(cols: number, rows: number): void {
    if (cols === this.terminal.cols && rows === this.terminal.rows) return;
    this.terminal.resize(cols, rows);
  }

  clear(): void {
    this.terminal.write("", () => this.terminal.clear());
  }

  // Writes parse asynchronously in order; this callback runs after all earlier writes land.
  snapshot(): Promise<string> {
    return new Promise((resolve) => {
      this.terminal.write("", () => resolve(this.serializer.serialize()));
    });
  }

  dispose(): void {
    this.terminal.dispose();
  }
}
