// @vitest-environment node
import { describe, it, expect } from "vitest";
import { extractOwnerRepo } from "@/lib/git/utils";

describe("extractOwnerRepo", () => {
  it("extracts owner and repo from HTTPS URL with .git", () => {
    expect(extractOwnerRepo("https://github.com/acme/app.git")).toEqual({
      owner: "acme",
      repo: "app",
    });
  });

  it("extracts owner and repo from HTTPS URL without .git", () => {
    expect(extractOwnerRepo("https://github.com/acme/app")).toEqual({
      owner: "acme",
      repo: "app",
    });
  });

  it("extracts owner and repo from SSH URL with .git", () => {
    expect(extractOwnerRepo("git@github.com:acme/app.git")).toEqual({
      owner: "acme",
      repo: "app",
    });
  });

  it("extracts owner and repo from SSH URL without .git", () => {
    expect(extractOwnerRepo("git@github.com:acme/app")).toEqual({
      owner: "acme",
      repo: "app",
    });
  });

  it("handles trailing slash", () => {
    expect(extractOwnerRepo("https://github.com/acme/app/")).toEqual({
      owner: "acme",
      repo: "app",
    });
  });

  it("returns null for non-GitHub HTTPS host", () => {
    expect(extractOwnerRepo("https://gitlab.com/acme/app.git")).toBeNull();
  });

  it("returns null for non-GitHub SSH host", () => {
    expect(extractOwnerRepo("git@gitlab.com:acme/app.git")).toBeNull();
  });

  it("returns null for invalid URL", () => {
    expect(extractOwnerRepo("not-a-url")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(extractOwnerRepo("")).toBeNull();
  });

  it("returns null for non-string input", () => {
    expect(extractOwnerRepo(null as unknown as string)).toBeNull();
  });
});
