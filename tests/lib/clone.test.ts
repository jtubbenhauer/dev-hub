// @vitest-environment node
import { describe, it, expect } from "vitest"
import { extractRepoName } from "@/lib/git/clone"

describe("extractRepoName", () => {
  it("extracts name from HTTPS URL with .git suffix", () => {
    expect(extractRepoName("https://github.com/user/my-repo.git")).toBe("my-repo")
  })

  it("extracts name from HTTPS URL without .git suffix", () => {
    expect(extractRepoName("https://github.com/user/my-repo")).toBe("my-repo")
  })

  it("extracts name from SSH URL with .git suffix", () => {
    expect(extractRepoName("git@github.com:user/my-repo.git")).toBe("my-repo")
  })

  it("extracts name from SSH URL without .git suffix", () => {
    expect(extractRepoName("git@github.com:user/my-repo")).toBe("my-repo")
  })

  it("strips trailing slashes before extracting", () => {
    expect(extractRepoName("https://github.com/user/my-repo/")).toBe("my-repo")
    expect(extractRepoName("https://github.com/user/my-repo///")).toBe("my-repo")
  })

  it("handles URLs with nested paths (e.g. GitLab subgroups)", () => {
    expect(extractRepoName("https://gitlab.com/org/group/subgroup/my-repo.git")).toBe("my-repo")
  })

  it("handles repo names with dots", () => {
    expect(extractRepoName("https://github.com/user/my.dotted.repo.git")).toBe("my.dotted.repo")
  })

  it("throws for a URL that yields an empty name", () => {
    expect(() => extractRepoName("")).toThrow()
  })
})
