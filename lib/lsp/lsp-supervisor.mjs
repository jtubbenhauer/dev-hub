import { spawn } from "node:child_process";
import process from "node:process";

const [parentArgument, separator, command, ...args] = process.argv.slice(2);
const parentMatch = /^--parent-pid=([0-9]+)$/.exec(parentArgument ?? "");
const parentPid = Number(parentMatch?.[1]);
if (
  !Number.isSafeInteger(parentPid) ||
  parentPid <= 0 ||
  separator !== "--" ||
  !command ||
  command.includes("\0") ||
  args.some((argument) => argument.includes("\0"))
) {
  process.stderr.write(
    "[lsp-supervisor] usage: node lsp-supervisor.mjs --parent-pid=<pid> -- <command> [args...]\n",
  );
  process.exit(2);
}

let isExiting = false;
function killGroupAndExit(reason) {
  if (isExiting) return;
  isExiting = true;
  process.stderr.write(`[lsp-supervisor] ${reason}\n`);
  try {
    process.kill(-process.pid, "SIGKILL");
  } finally {
    process.exit(1);
  }
}

const child = spawn(command, args, { stdio: "inherit" });
child.on("exit", (code, signal) =>
  killGroupAndExit(`vtsls exited (code ${code}, signal ${signal})`),
);
child.on("error", (error) =>
  killGroupAndExit(`vtsls failed to start: ${error.message}`),
);
for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) {
  process.on(signal, () => killGroupAndExit(`received ${signal}`));
}
setInterval(() => {
  try {
    process.kill(parentPid, 0);
  } catch {
    killGroupAndExit(`parent ${parentPid} is gone`);
  }
}, 1_000);
