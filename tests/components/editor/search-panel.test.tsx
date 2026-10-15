import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ContentSearchMatch, ContentSearchOutcome } from "@devhub/shared";

import { SearchPanel } from "@/components/editor/search-panel";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useContentSearchStore } from "@/stores/content-search-store";

// Counts HighlightedText renders per preview text so the memo test can assert
// that moving the selection re-renders only the affected rows.
const highlightRenderCounts = vi.hoisted(() => new Map<string, number>());

vi.mock("@/components/ui/highlighted-text", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/components/ui/highlighted-text")>();
  function CountingHighlightedText(
    props: Parameters<typeof actual.HighlightedText>[0],
  ) {
    highlightRenderCounts.set(
      props.text,
      (highlightRenderCounts.get(props.text) ?? 0) + 1,
    );
    return actual.HighlightedText(props);
  }
  return { HighlightedText: CountingHighlightedText };
});

type OkOutcome = Extract<ContentSearchOutcome, { kind: "ok" }>;

const LINE_SHA = "0".repeat(64);

function makeMatch(
  preview: string,
  previewMatchStart: number,
  previewMatchEnd: number,
  lineNumber = 1,
): ContentSearchMatch {
  return {
    lineNumber,
    startColumn: previewMatchStart + 1,
    endColumn: previewMatchEnd + 1,
    startByteColumn: previewMatchStart + 1,
    matchFingerprint: "fingerprint",
    lineSha256: LINE_SHA,
    preview,
    previewMatchStart,
    previewMatchEnd,
  };
}

// "alphaOne" etc. are the highlighted spans, unique per match row.
function makeOkOutcome(overrides: Partial<OkOutcome> = {}): OkOutcome {
  return {
    kind: "ok",
    files: [
      {
        path: "src/alpha.ts",
        matches: [
          makeMatch("const alphaOne = 1;", 6, 14, 1),
          makeMatch("const alphaTwo = 2;", 6, 14, 2),
        ],
      },
      {
        path: "lib/beta.ts",
        matches: [makeMatch("const betaOne = 3;", 6, 13)],
      },
    ],
    matchCount: 3,
    fileCount: 2,
    isLimitHit: false,
    isTimedOut: false,
    engine: "ripgrep",
    durationMs: 5,
    ...overrides,
  };
}

function stubFetch(outcome: ContentSearchOutcome) {
  const fetchMock = vi.fn<typeof fetch>(async () => Response.json(outcome));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function requestedUrl(
  fetchMock: ReturnType<typeof stubFetch>,
  callIndex: number,
): URL {
  const input = fetchMock.mock.calls[callIndex]?.[0];
  if (typeof input !== "string") {
    throw new Error(`fetch call ${callIndex} has no string URL`);
  }
  return new URL(input, "http://localhost");
}

const queryClients: QueryClient[] = [];

function renderPanel(workspaceId: string | null = "ws-1") {
  const onOpenMatch = vi.fn();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  queryClients.push(queryClient);
  render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <SearchPanel workspaceId={workspaceId} onOpenMatch={onOpenMatch} />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  return { onOpenMatch };
}

function searchInput(): HTMLElement {
  return screen.getByRole("textbox", { name: "Search in files" });
}

beforeEach(() => {
  useContentSearchStore.setState({
    pattern: "",
    isRegex: false,
    isCaseSensitive: false,
    isWholeWord: false,
    includeText: "",
    excludeText: "",
    isDetailsOpen: false,
    sidebarView: "explorer",
    pendingFocus: false,
  });
  highlightRenderCounts.clear();
});

afterEach(() => {
  for (const queryClient of queryClients.splice(0)) queryClient.clear();
  vi.unstubAllGlobals();
});

describe("SearchPanel results", () => {
  it("shows grouped results and the result count after typing", async () => {
    stubFetch(makeOkOutcome());
    const user = userEvent.setup();
    renderPanel();

    await user.type(searchInput(), "alpha");

    // The 300ms debounce sits between typing and the request.
    expect(
      await screen.findByText("3 results in 2 files", {}, { timeout: 3000 }),
    ).toBeInTheDocument();
    expect(screen.getByText("alpha.ts")).toBeInTheDocument();
    expect(screen.getByText("beta.ts")).toBeInTheDocument();
    expect(screen.getByText("alphaOne")).toBeInTheDocument();
    expect(screen.getByText("alphaTwo")).toBeInTheDocument();
    expect(screen.getByText("betaOne")).toBeInTheDocument();
  });

  it("sends caseSensitive=1 after toggling Match case, with aria-pressed set", async () => {
    const fetchMock = stubFetch(makeOkOutcome());
    useContentSearchStore.setState({ pattern: "alpha" });
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText("3 results in 2 files", {}, { timeout: 3000 });

    const toggle = screen.getByRole("button", { name: "Match case" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    await user.click(toggle);

    expect(toggle).toHaveAttribute("aria-pressed", "true");
    await waitFor(
      () => expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2),
      { timeout: 3000 },
    );
    const url = requestedUrl(fetchMock, fetchMock.mock.calls.length - 1);
    expect(url.searchParams.get("caseSensitive")).toBe("1");
  });

  it("sends the include globs typed in the details inputs", async () => {
    const fetchMock = stubFetch(makeOkOutcome());
    useContentSearchStore.setState({ pattern: "alpha" });
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText("3 results in 2 files", {}, { timeout: 3000 });

    await user.click(
      screen.getByRole("button", { name: "Toggle search details" }),
    );
    await user.type(
      screen.getByRole("textbox", { name: "Files to include" }),
      "src",
    );

    await waitFor(
      () => {
        const url = requestedUrl(fetchMock, fetchMock.mock.calls.length - 1);
        expect(url.searchParams.get("include")).toBe("src");
      },
      { timeout: 3000 },
    );
  });

  it("opens a match on click with its path and match", async () => {
    stubFetch(makeOkOutcome());
    useContentSearchStore.setState({ pattern: "alpha" });
    const user = userEvent.setup();
    const { onOpenMatch } = renderPanel();
    await screen.findByText("3 results in 2 files", {}, { timeout: 3000 });

    const row = screen.getByText("alphaTwo").closest("button");
    if (row === null) throw new Error("match row button not found");
    await user.click(row);

    expect(onOpenMatch).toHaveBeenCalledWith(
      "src/alpha.ts",
      expect.objectContaining({
        preview: "const alphaTwo = 2;",
        lineNumber: 2,
      }),
    );
  });

  it("opens the first match with ArrowDown + Enter", async () => {
    stubFetch(makeOkOutcome());
    useContentSearchStore.setState({ pattern: "alpha" });
    const user = userEvent.setup();
    const { onOpenMatch } = renderPanel();
    await screen.findByText("3 results in 2 files", {}, { timeout: 3000 });

    await user.click(searchInput());
    await user.keyboard("{ArrowDown}{Enter}");

    expect(onOpenMatch).toHaveBeenCalledWith(
      "src/alpha.ts",
      expect.objectContaining({
        preview: "const alphaOne = 1;",
        lineNumber: 1,
      }),
    );
  });

  it("hides a file's match rows when its header is collapsed", async () => {
    stubFetch(makeOkOutcome());
    useContentSearchStore.setState({ pattern: "alpha" });
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText("3 results in 2 files", {}, { timeout: 3000 });

    const header = screen.getByText("alpha.ts").closest("button");
    if (header === null) throw new Error("file header button not found");
    await user.click(header);

    expect(screen.queryByText("alphaOne")).not.toBeInTheDocument();
    expect(screen.queryByText("alphaTwo")).not.toBeInTheDocument();
    expect(screen.getByText("betaOne")).toBeInTheDocument();
  });
});

describe("SearchPanel status line", () => {
  it("shows the limit notice when the result limit is hit", async () => {
    stubFetch(makeOkOutcome({ isLimitHit: true }));
    useContentSearchStore.setState({ pattern: "alpha" });
    renderPanel();

    expect(
      await screen.findByText(
        "Showing the first 3 results. Narrow your search to see more.",
        {},
        { timeout: 3000 },
      ),
    ).toBeInTheDocument();
  });

  it("shows the zero-match limit notice instead of 'No results found.' when the limit is hit with no verified matches", async () => {
    stubFetch(
      makeOkOutcome({
        files: [],
        matchCount: 0,
        fileCount: 0,
        isLimitHit: true,
      }),
    );
    useContentSearchStore.setState({ pattern: "alpha" });
    renderPanel();

    expect(
      await screen.findByText(
        "No results among the first matches. Narrow your search to see more.",
        {},
        { timeout: 3000 },
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("No results found.")).not.toBeInTheDocument();
  });

  it("shows 'No results found.' for zero matches without a limit hit", async () => {
    stubFetch(makeOkOutcome({ files: [], matchCount: 0, fileCount: 0 }));
    useContentSearchStore.setState({ pattern: "alpha" });
    renderPanel();

    expect(
      await screen.findByText("No results found.", {}, { timeout: 3000 }),
    ).toBeInTheDocument();
  });

  it("keeps 'No results found.' plus the timeout notice for a zero-match timeout", async () => {
    stubFetch(
      makeOkOutcome({
        files: [],
        matchCount: 0,
        fileCount: 0,
        isTimedOut: true,
      }),
    );
    useContentSearchStore.setState({ pattern: "alpha" });
    renderPanel();

    expect(
      await screen.findByText("No results found.", {}, { timeout: 3000 }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Search timed out after 15 seconds. Showing partial results.",
      ),
    ).toBeInTheDocument();
  });

  it("shows the timeout notice when the search timed out", async () => {
    stubFetch(makeOkOutcome({ isTimedOut: true }));
    useContentSearchStore.setState({ pattern: "alpha" });
    renderPanel();

    expect(
      await screen.findByText(
        "Search timed out after 15 seconds. Showing partial results.",
        {},
        { timeout: 3000 },
      ),
    ).toBeInTheDocument();
  });

  it("shows the git grep note when the engine is git-grep", async () => {
    stubFetch(makeOkOutcome({ engine: "git-grep" }));
    useContentSearchStore.setState({ pattern: "alpha" });
    renderPanel();

    expect(
      await screen.findByText(
        "Using git grep (install ripgrep for faster search)",
        {},
        { timeout: 3000 },
      ),
    ).toBeInTheDocument();
  });

  it("shows an invalid-pattern message in destructive text with no results list", async () => {
    stubFetch({
      kind: "invalid-pattern",
      message: "Unclosed group in pattern",
    });
    useContentSearchStore.setState({ pattern: "(alpha" });
    renderPanel();

    const message = await screen.findByText(
      "Unclosed group in pattern",
      {},
      { timeout: 3000 },
    );
    expect(message).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveClass("text-destructive");
    expect(screen.queryByText("alpha.ts")).not.toBeInTheDocument();
    expect(document.querySelector("[data-match-key]")).toBeNull();
  });
});

describe("SearchPanel focus", () => {
  it("focuses the input and consumes pendingFocus", async () => {
    stubFetch(makeOkOutcome());
    useContentSearchStore.setState({ pendingFocus: true });
    renderPanel();

    await waitFor(() => expect(searchInput()).toHaveFocus());
    expect(useContentSearchStore.getState().pendingFocus).toBe(false);
  });
});

describe("SearchPanel layout and truncation (jsdom class assertions)", () => {
  it("constrains result rows to the pane and truncates previews", async () => {
    stubFetch(makeOkOutcome());
    useContentSearchStore.setState({ pattern: "alpha" });
    renderPanel();
    await screen.findByText("3 results in 2 files", {}, { timeout: 3000 });

    // Radix ScrollArea's viewport wraps children in a `display: table;
    // min-width: 100%` div; the override forces it back to block so w-full
    // and truncate can constrain rows to the pane width.
    const scrollArea = document.querySelector("[data-slot=scroll-area]");
    if (scrollArea === null) throw new Error("scroll area not found");
    expect(scrollArea).toHaveClass(
      "[&>[data-slot=scroll-area-viewport]]:!overflow-x-hidden",
      "[&>[data-slot=scroll-area-viewport]>div]:!block",
    );

    const row = document.querySelector('[data-match-key="src/alpha.ts:0"]');
    if (row === null) throw new Error("match row not found");
    expect(row).toHaveClass("w-full", "min-w-0");

    const preview = row.querySelector("span");
    if (preview === null) throw new Error("preview span not found");
    expect(preview).toHaveClass(
      "min-w-0",
      "flex-1",
      "overflow-hidden",
      "text-ellipsis",
      "whitespace-pre",
    );

    // File header dirname also truncates.
    expect(screen.getByText("src")).toHaveClass("truncate");
  });

  it("truncates long basenames in file headers and keeps the badge visible", async () => {
    stubFetch(makeOkOutcome());
    useContentSearchStore.setState({ pattern: "alpha" });
    renderPanel();
    await screen.findByText("3 results in 2 files", {}, { timeout: 3000 });

    // shrink-0 keeps the basename at its natural width; max-w-full + truncate
    // ellipsizes it only when the basename ALONE exceeds the container.
    const basename = screen.getByText("alpha.ts");
    expect(basename).toHaveClass("shrink-0", "max-w-full", "truncate");

    // The dirname takes only the leftover space and gives way first.
    const dirname = screen.getByText("src");
    expect(dirname).toHaveClass("min-w-0", "flex-1", "truncate");

    const header = basename.closest("button");
    if (header === null) throw new Error("file header button not found");
    expect(header).toHaveClass("min-w-0");
    expect(header).toHaveAttribute("title", "src/alpha.ts");

    // alpha.ts has 2 matches; its count badge never shrinks away.
    const badge = screen.getByText("2");
    expect(badge).toHaveClass("shrink-0");
  });

  it("re-renders only the affected match rows when the selection moves", async () => {
    stubFetch(makeOkOutcome());
    useContentSearchStore.setState({ pattern: "alpha" });
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText("3 results in 2 files", {}, { timeout: 3000 });

    await user.click(searchInput());
    highlightRenderCounts.clear();
    await user.keyboard("{ArrowDown}");

    // Selecting row 0 must not re-render the other rows.
    expect(
      highlightRenderCounts.get("const alphaOne = 1;") ?? 0,
    ).toBeGreaterThanOrEqual(1);
    expect(highlightRenderCounts.get("const alphaTwo = 2;") ?? 0).toBe(0);
    expect(highlightRenderCounts.get("const betaOne = 3;") ?? 0).toBe(0);

    highlightRenderCounts.clear();
    await user.keyboard("{ArrowDown}");

    // Moving 0 -> 1 re-renders the deselected and newly-selected rows only.
    expect(
      highlightRenderCounts.get("const alphaOne = 1;") ?? 0,
    ).toBeGreaterThanOrEqual(1);
    expect(
      highlightRenderCounts.get("const alphaTwo = 2;") ?? 0,
    ).toBeGreaterThanOrEqual(1);
    expect(highlightRenderCounts.get("const betaOne = 3;") ?? 0).toBe(0);
  });

  it("renders a multi-line error message verbatim, pre-wrapped and monospace", async () => {
    const message =
      "regex parse error:\n    (alpha\n    ^\nerror: unclosed group";
    stubFetch({ kind: "invalid-pattern", message });
    useContentSearchStore.setState({ pattern: "(alpha" });
    renderPanel();

    await waitFor(
      () => expect(screen.getByRole("status").textContent).toBe(message),
      { timeout: 3000 },
    );
    const line = screen.getByRole("status").querySelector("p");
    if (line === null) throw new Error("status line not found");
    expect(line).toHaveClass("whitespace-pre-wrap", "break-words", "font-mono");
  });

  it("renders a single-line error pre-wrapped but not monospace", async () => {
    stubFetch({ kind: "failed", message: "Search failed (500)" });
    useContentSearchStore.setState({ pattern: "alpha" });
    renderPanel();

    const line = await screen.findByText(
      "Search failed (500)",
      {},
      { timeout: 3000 },
    );
    expect(line).toHaveClass("whitespace-pre-wrap", "break-words");
    expect(line).not.toHaveClass("font-mono");
  });
});
