import { describe, it, expect } from "vitest";
import {
  buildLocalFolderUri,
  buildRemoteFolderUri,
  encodeUriPath,
  isValidSshTarget,
  resolveVscodeTarget,
  type VscodeWorkspaceInput,
} from "@/lib/vscode";

function localWorkspace(
  overrides: Partial<VscodeWorkspaceInput> = {},
): VscodeWorkspaceInput {
  return {
    path: "/Users/alice/project",
    backend: "local",
    sshTarget: null,
    sshPath: null,
    ...overrides,
  };
}

function remoteWorkspace(
  overrides: Partial<VscodeWorkspaceInput> = {},
): VscodeWorkspaceInput {
  return {
    path: "/workspace",
    backend: "remote",
    sshTarget: "devbox",
    sshPath: "/srv/workspaces/project",
    ...overrides,
  };
}

describe("encodeUriPath", () => {
  it("leaves a plain posix path untouched", () => {
    expect(encodeUriPath("/home/alice/project")).toBe("/home/alice/project");
  });

  it("encodes spaces in a segment", () => {
    expect(encodeUriPath("/home/alice/My Project")).toBe(
      "/home/alice/My%20Project",
    );
  });

  it("encodes characters that would otherwise be URI syntax", () => {
    expect(encodeUriPath("/home/a#b")).toBe("/home/a%23b");
    expect(encodeUriPath("/home/a?b")).toBe("/home/a%3Fb");
    expect(encodeUriPath("/home/100%")).toBe("/home/100%25");
  });

  it("preserves structural slashes rather than encoding them", () => {
    expect(encodeUriPath("/a/b/c")).not.toContain("%2F");
  });

  it("normalises backslashes and lowercases a windows drive letter", () => {
    expect(encodeUriPath("C:\\Users\\alice\\project")).toBe(
      "c:/Users/alice/project",
    );
  });
});

describe("isValidSshTarget", () => {
  it.each([
    "devbox",
    "dev-box.example.com",
    "alice@devbox",
    "alice@devbox:2222",
    "192.168.1.10",
    "[2001:db8::1]",
    "host_1",
  ])("accepts %s", (target: string) => {
    expect(isValidSshTarget(target)).toBe(true);
  });

  it.each([
    "",
    "-oProxyCommand=evil",
    "host; rm -rf /",
    "host name",
    "host\nname",
    "host/path",
    "host$(whoami)",
    "host`id`",
    "host|tee",
  ])("rejects %j", (target: string) => {
    expect(isValidSshTarget(target)).toBe(false);
  });

  it("rejects an over-long target", () => {
    expect(isValidSshTarget("a".repeat(256))).toBe(false);
  });
});

describe("buildLocalFolderUri", () => {
  it("builds a folder uri with a trailing slash", () => {
    expect(buildLocalFolderUri("/Users/alice/project")).toBe(
      "vscode://file/Users/alice/project/?windowId=_blank",
    );
  });

  it("does not double an existing trailing slash", () => {
    expect(buildLocalFolderUri("/Users/alice/project/")).toBe(
      "vscode://file/Users/alice/project/?windowId=_blank",
    );
  });

  it("puts the new-window query after the trailing slash", () => {
    // Ordering is load-bearing: the slash must stay part of the path so the
    // target is still treated as a folder.
    expect(buildLocalFolderUri("/p")).toMatch(/\/\?windowId=_blank$/);
  });

  it("uses the scheme for the selected flavor", () => {
    expect(buildLocalFolderUri("/p", "cursor")).toBe(
      "cursor://file/p/?windowId=_blank",
    );
    expect(buildLocalFolderUri("/p", "vscode-insiders")).toBe(
      "vscode-insiders://file/p/?windowId=_blank",
    );
    expect(buildLocalFolderUri("/p", "vscodium")).toBe(
      "vscodium://file/p/?windowId=_blank",
    );
    expect(buildLocalFolderUri("/p", "windsurf")).toBe(
      "windsurf://file/p/?windowId=_blank",
    );
  });
});

describe("buildRemoteFolderUri", () => {
  it("builds an ssh-remote authority with a literal plus", () => {
    expect(buildRemoteFolderUri("devbox", "/home/alice/project")).toBe(
      "vscode://vscode-remote/ssh-remote+devbox/home/alice/project/?windowId=_blank",
    );
  });

  it("preserves user and port in the authority", () => {
    expect(buildRemoteFolderUri("alice@devbox:2222", "/srv/app")).toBe(
      "vscode://vscode-remote/ssh-remote+alice@devbox:2222/srv/app/?windowId=_blank",
    );
  });

  it("puts the new-window query after the trailing slash", () => {
    expect(buildRemoteFolderUri("devbox", "/srv/app")).toMatch(
      /\/\?windowId=_blank$/,
    );
  });

  it("adds a leading slash to a relative remote path", () => {
    expect(buildRemoteFolderUri("devbox", "srv/app")).toBe(
      "vscode://vscode-remote/ssh-remote+devbox/srv/app/?windowId=_blank",
    );
  });
});

describe("resolveVscodeTarget", () => {
  it("resolves a local workspace from its path", () => {
    expect(resolveVscodeTarget(localWorkspace())).toEqual({
      kind: "local",
      uri: "vscode://file/Users/alice/project/?windowId=_blank",
    });
  });

  it("reports unconfigured when a local workspace has no path", () => {
    const result = resolveVscodeTarget(localWorkspace({ path: null }));
    expect(result.kind).toBe("unconfigured");
  });

  it("prefers the declared ssh path over the agent-local path", () => {
    const result = resolveVscodeTarget(remoteWorkspace());
    expect(result).toEqual({
      kind: "remote",
      uri: "vscode://vscode-remote/ssh-remote+devbox/srv/workspaces/project/?windowId=_blank",
      sshTarget: "devbox",
      sshPath: "/srv/workspaces/project",
    });
  });

  it("falls back to the workspace path when no ssh path is declared", () => {
    const result = resolveVscodeTarget(
      remoteWorkspace({ sshPath: null, path: "/home/alice/repo" }),
    );
    expect(result).toEqual({
      kind: "remote",
      uri: "vscode://vscode-remote/ssh-remote+devbox/home/alice/repo/?windowId=_blank",
      sshTarget: "devbox",
      sshPath: "/home/alice/repo",
    });
  });

  it("reports unconfigured when a remote workspace has no ssh target", () => {
    const result = resolveVscodeTarget(remoteWorkspace({ sshTarget: null }));
    expect(result).toEqual({
      kind: "unconfigured",
      reason: "No SSH target configured for this remote workspace",
    });
  });

  it("reports unconfigured rather than emitting an unsafe ssh target", () => {
    const result = resolveVscodeTarget(
      remoteWorkspace({ sshTarget: "-oProxyCommand=touch /tmp/pwned" }),
    );
    expect(result).toEqual({
      kind: "unconfigured",
      reason: "SSH target is not a valid host",
    });
  });

  it("treats a whitespace-only ssh target as unconfigured", () => {
    const result = resolveVscodeTarget(remoteWorkspace({ sshTarget: "   " }));
    expect(result.kind).toBe("unconfigured");
  });

  it("encodes a remote path containing spaces", () => {
    const result = resolveVscodeTarget(
      remoteWorkspace({ sshPath: "/srv/My Project" }),
    );
    expect(result).toMatchObject({
      kind: "remote",
      uri: "vscode://vscode-remote/ssh-remote+devbox/srv/My%20Project/?windowId=_blank",
    });
  });

  it("applies the selected flavor to remote uris", () => {
    const result = resolveVscodeTarget(remoteWorkspace(), "cursor");
    expect(result).toMatchObject({
      uri: "cursor://vscode-remote/ssh-remote+devbox/srv/workspaces/project/?windowId=_blank",
    });
  });
});
