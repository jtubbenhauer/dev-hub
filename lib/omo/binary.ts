import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { OmoBinaryError, OmoUnsupportedPlatformError } from "./errors";

export type OmoBinaryVersions = {
  readonly omoVersion: string;
  readonly senpiVersion: string;
};

const OMO_VERSION_PATTERN = /^omo\s+(\S+)\s+\(engine:\s*senpi\s+(\S+)\)\s*$/;

export function findOmoBinary(): string {
  const configuredBinary = process.env.OMO_BIN;
  if (configuredBinary) return configuredBinary;

  const bunBinary = join(homedir(), ".bun", "bin", "omo");
  return existsSync(bunBinary) ? bunBinary : "omo";
}

export function verifyOmoBinary(
  bin = findOmoBinary(),
): Promise<OmoBinaryVersions> {
  return new Promise((resolve, reject) => {
    execFile(bin, ["--version"], { timeout: 5000 }, (error, stdout, stderr) => {
      if (error) {
        reject(new OmoBinaryError(stderr));
        return;
      }

      const match = stdout.match(OMO_VERSION_PATTERN);
      const omoVersion = match?.[1];
      const senpiVersion = match?.[2];
      if (!omoVersion || !senpiVersion) {
        reject(new OmoBinaryError(stderr));
        return;
      }

      resolve({ omoVersion, senpiVersion });
    });
  });
}

export function assertSupportedPlatform(): void {
  if (process.platform === "win32") {
    throw new OmoUnsupportedPlatformError();
  }
}
