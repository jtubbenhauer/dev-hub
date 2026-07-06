import { Hono } from "hono";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCb);

export function opencodeRoutes(): Hono {
  const app = new Hono();

  app.post("/restart", async (c) => {
    let pids: number[] = [];

    try {
      const { stdout } = await execFile("pgrep", ["-f", "opencode serve"]);
      pids = stdout
        .trim()
        .split("\n")
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => Number.isFinite(n) && n > 0);
    } catch (err) {
      const error = err as { code?: number; message?: string };
      if (error.code !== 1) {
        return c.json(
          {
            restarted: false,
            error: error.message ?? "Failed to find opencode process",
          },
          500,
        );
      }
    }

    let killed = 0;
    for (const pid of pids) {
      try {
        process.kill(pid, "SIGTERM");
        killed++;
      } catch {
        // process already gone
      }
    }

    return c.json({ restarted: true, killedCount: killed, pids });
  });

  return app;
}
