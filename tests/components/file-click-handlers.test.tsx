import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { FilePathCode } from "@/components/chat/file-path-code";

const mockRouterPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockRouterPush }),
}));

const mockUseIsMobile = vi.fn<() => boolean>();
vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => mockUseIsMobile(),
}));

vi.mock("@/stores/workspace-store", () => ({
  useWorkspaceStore: vi.fn(
    (selector: (s: { activeWorkspaceId: string }) => unknown) =>
      selector({ activeWorkspaceId: "ws-1" }),
  ),
}));

const mockOpenFile = vi.fn();
const mockSetIsLoading = vi.fn();
const mockClearError = vi.fn();

vi.mock("@/stores/split-panel-store", () => ({
  useSplitPanelStore: Object.assign(vi.fn(), {
    getState: vi.fn(() => ({
      openFile: mockOpenFile,
      setIsLoading: mockSetIsLoading,
      clearError: mockClearError,
    })),
  }),
}));

function makeOkResponse(content: string, language = "typescript") {
  return Promise.resolve(
    new Response(JSON.stringify({ content, language }), { status: 200 }),
  );
}

function makeErrorResponse(status = 500) {
  return Promise.resolve(new Response(null, { status }));
}

function renderFile(text: string) {
  return render(<FilePathCode text={text}>{text}</FilePathCode>);
}

describe("FilePathCode — desktop file click", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseIsMobile.mockReturnValue(false);
    global.fetch = vi
      .fn()
      .mockImplementation(() => makeOkResponse("const x = 1"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls fetch and then openFile on success", async () => {
    renderFile("src/utils.ts");
    fireEvent.click(screen.getByRole("link"));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledOnce();
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("workspaceId=ws-1"),
      );
    });

    await waitFor(() => {
      expect(mockOpenFile).toHaveBeenCalledWith(
        "src/utils.ts",
        "const x = 1",
        "typescript",
      );
    });

    expect(mockRouterPush).not.toHaveBeenCalled();
  });

  it("calls setIsLoading(true) before fetch and setIsLoading(false) after", async () => {
    renderFile("src/utils.ts");
    fireEvent.click(screen.getByRole("link"));

    await waitFor(() => {
      expect(mockSetIsLoading).toHaveBeenCalledWith(true);
      expect(mockSetIsLoading).toHaveBeenCalledWith(false);
    });
  });
});

describe("FilePathCode — mobile file click", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseIsMobile.mockReturnValue(true);
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls router.push and does NOT call fetch", () => {
    renderFile("src/utils.ts");
    fireEvent.click(screen.getByRole("link"));

    expect(mockRouterPush).toHaveBeenCalledOnce();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("router.push uses the correct file href", () => {
    renderFile("src/utils.ts");
    fireEvent.click(screen.getByRole("link"));

    expect(mockRouterPush).toHaveBeenCalledWith(
      expect.stringContaining("open="),
    );
  });
});

describe("FilePathCode — desktop folder click", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseIsMobile.mockReturnValue(false);
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls router.push with expand= param for folder paths", () => {
    renderFile("src/components/chat");
    fireEvent.click(screen.getByRole("link"));

    expect(mockRouterPush).toHaveBeenCalledWith(
      expect.stringContaining("expand="),
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe("FilePathCode — fetch failure fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseIsMobile.mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("falls back to router.push when fetch returns non-ok status", async () => {
    global.fetch = vi.fn().mockImplementation(() => makeErrorResponse(404));
    renderFile("src/utils.ts");
    fireEvent.click(screen.getByRole("link"));

    await waitFor(() => {
      expect(mockRouterPush).toHaveBeenCalledOnce();
    });

    expect(mockOpenFile).not.toHaveBeenCalled();
  });

  it("falls back to router.push when fetch throws a network error", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("network error"));
    renderFile("src/utils.ts");
    fireEvent.click(screen.getByRole("link"));

    await waitFor(() => {
      expect(mockRouterPush).toHaveBeenCalledOnce();
    });

    expect(mockOpenFile).not.toHaveBeenCalled();
  });
});

describe("FilePathCode — mobile file click", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseIsMobile.mockReturnValue(true);
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls router.push and does NOT call fetch", () => {
    renderFile("src/utils.ts");
    fireEvent.click(screen.getByRole("link"));

    expect(mockRouterPush).toHaveBeenCalledOnce();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("router.push uses the correct file href", () => {
    renderFile("src/utils.ts");
    fireEvent.click(screen.getByRole("link"));

    expect(mockRouterPush).toHaveBeenCalledWith(
      expect.stringContaining("open="),
    );
  });
});

describe("FilePathCode — desktop folder click", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseIsMobile.mockReturnValue(false);
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls router.push with expand= param for folder paths", () => {
    // A path like "src/components/chat" is a folder (multiple segments, no extension on last part)
    renderFile("src/components/chat");
    fireEvent.click(screen.getByRole("link"));

    expect(mockRouterPush).toHaveBeenCalledWith(
      expect.stringContaining("expand="),
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe("FilePathCode — fetch failure fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseIsMobile.mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("falls back to router.push when fetch returns non-ok status", async () => {
    global.fetch = vi.fn().mockImplementation(() => makeErrorResponse(404));
    renderFile("src/utils.ts");
    fireEvent.click(screen.getByRole("link"));

    await waitFor(() => {
      expect(mockRouterPush).toHaveBeenCalledOnce();
    });

    expect(mockOpenFile).not.toHaveBeenCalled();
  });

  it("falls back to router.push when fetch throws a network error", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("network error"));
    renderFile("src/utils.ts");
    fireEvent.click(screen.getByRole("link"));

    await waitFor(() => {
      expect(mockRouterPush).toHaveBeenCalledOnce();
    });

    expect(mockOpenFile).not.toHaveBeenCalled();
  });
});
