import { describe, it, expect } from "vitest";
import {
  parseSshConfig,
  resolveSshAlias,
  type SshHostEntry,
} from "@/lib/ssh-config";

// Mirrors the real rig-cli generated block shape.
const RIG_CONFIG = `
# managed by rig-cli
Host devrig-69-ws-ai-proof-of-concept
  HostName dev-rig
  Port 28901
  User dev
  ForwardAgent yes
  StrictHostKeyChecking no
  UserKnownHostsFile /dev/null

Host devrig-69-ws-new-website
  HostName dev-rig
  Port 28907
  User dev

Host devrig-69-ws-review-missing-allocations
  HostName dev-rig
  Port 28911
  User dev

Host vscode-dev
  HostName 34.116.76.39
  IdentityFile /Users/someone/.ssh/google_compute_engine
`;

describe("parseSshConfig", () => {
  it("parses alias, hostname, port and user", () => {
    const entries = parseSshConfig(RIG_CONFIG);
    const entry = entries.find(
      (e) => e.alias === "devrig-69-ws-ai-proof-of-concept",
    );
    expect(entry).toEqual({
      alias: "devrig-69-ws-ai-proof-of-concept",
      hostName: "dev-rig",
      port: 28901,
      user: "dev",
    });
  });

  it("ignores comments and blank lines", () => {
    const entries = parseSshConfig(RIG_CONFIG);
    expect(entries.every((e) => !e.alias.startsWith("#"))).toBe(true);
  });

  it("handles an entry with no port or user", () => {
    const entries = parseSshConfig(RIG_CONFIG);
    const entry = entries.find((e) => e.alias === "vscode-dev");
    expect(entry).toMatchObject({ hostName: "34.116.76.39", port: null });
  });

  it("supports multiple aliases on one Host line", () => {
    const entries = parseSshConfig("Host a b\n  HostName h\n  Port 22\n");
    expect(entries.map((e) => e.alias)).toEqual(["a", "b"]);
    expect(entries.every((e) => e.hostName === "h" && e.port === 22)).toBe(
      true,
    );
  });

  it("supports the key=value form", () => {
    const entries = parseSshConfig("Host a\n  HostName=h\n  Port=2222\n");
    expect(entries[0]).toMatchObject({ hostName: "h", port: 2222 });
  });

  it("is case insensitive for keys", () => {
    const entries = parseSshConfig("host a\n  HOSTNAME h\n  poRT 2222\n");
    expect(entries[0]).toMatchObject({ hostName: "h", port: 2222 });
  });

  it("skips wildcard patterns", () => {
    const entries = parseSshConfig(
      "Host *\n  User root\nHost a\n  HostName h\n",
    );
    expect(entries.map((e) => e.alias)).toEqual(["a"]);
  });

  it("stops applying keys after a Match block", () => {
    const entries = parseSshConfig(
      "Host a\n  HostName h\nMatch host b\n  User other\n",
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].user).toBeNull();
  });

  it("ignores a malformed port", () => {
    const entries = parseSshConfig("Host a\n  HostName h\n  Port abc\n");
    expect(entries[0].port).toBeNull();
  });

  it("returns an empty list for empty input", () => {
    expect(parseSshConfig("")).toEqual([]);
  });
});

describe("resolveSshAlias", () => {
  const entries = parseSshConfig(RIG_CONFIG);

  it("resolves a container id to its rig alias across the type token", () => {
    expect(
      resolveSshAlias(entries, "dev-rig", ["69-oc-ai-proof-of-concept"]),
    ).toEqual({
      kind: "resolved",
      alias: "devrig-69-ws-ai-proof-of-concept",
    });
  });

  it("matches when the stored host is fully qualified", () => {
    expect(
      resolveSshAlias(entries, "dev-rig.tailb6e1ab.ts.net", [
        "69-oc-new-website",
      ]),
    ).toEqual({ kind: "resolved", alias: "devrig-69-ws-new-website" });
  });

  it("matches when the config host is fully qualified", () => {
    const fqdn: SshHostEntry[] = [
      {
        alias: "devrig-69-ws-thing",
        hostName: "dev-rig.tailb6e1ab.ts.net",
        port: 28901,
        user: "dev",
      },
    ];
    expect(resolveSshAlias(fqdn, "dev-rig", ["69-oc-thing"])).toEqual({
      kind: "resolved",
      alias: "devrig-69-ws-thing",
    });
  });

  it("does not match a shorter name that shares a suffix", () => {
    // "69-oc-website" must not resolve to "devrig-69-ws-new-website".
    expect(resolveSshAlias(entries, "dev-rig", ["69-oc-website"])).toEqual({
      kind: "none",
    });
  });

  it("falls back to the next match key when the first misses", () => {
    expect(
      resolveSshAlias(entries, "dev-rig", [
        "99-oc-unknown",
        "69-oc-new-website",
      ]),
    ).toEqual({ kind: "resolved", alias: "devrig-69-ws-new-website" });
  });

  it("returns none for an unknown workspace", () => {
    expect(resolveSshAlias(entries, "dev-rig", ["69-oc-nonexistent"])).toEqual({
      kind: "none",
    });
  });

  it("returns none when the host does not match", () => {
    expect(
      resolveSshAlias(entries, "other-host", ["69-oc-ai-proof-of-concept"]),
    ).toEqual({ kind: "none" });
  });

  it("reports ambiguity rather than guessing", () => {
    const ambiguous: SshHostEntry[] = [
      { alias: "a-thing", hostName: "h", port: 1, user: null },
      { alias: "b-thing", hostName: "h", port: 2, user: null },
    ];
    const result = resolveSshAlias(ambiguous, "h", ["thing"]);
    expect(result.kind).toBe("ambiguous");
    expect(result).toMatchObject({ candidates: ["a-thing", "b-thing"] });
  });

  it("returns none for blank inputs", () => {
    expect(resolveSshAlias(entries, "", ["thing"]).kind).toBe("none");
    expect(resolveSshAlias(entries, "dev-rig", ["  "]).kind).toBe("none");
    expect(resolveSshAlias(entries, "dev-rig", []).kind).toBe("none");
  });
});
