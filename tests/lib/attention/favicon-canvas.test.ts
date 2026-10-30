import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  FAVICON_BASE_HREF,
  FAVICON_IMAGE_LOAD_TIMEOUT_MS,
  applyFaviconHref,
  isFaviconHrefApplied,
  loadFaviconBaseImage,
  renderFaviconFrame,
  restoreFaviconHref,
} from "@/lib/attention/favicon-canvas";

const FRAME_DATA_URL = "data:image/png;base64,FRAME";
const NEXT_ICON_HREF = "/favicon.ico?favicon.abc.ico";

type DrawCall =
  | { readonly kind: "drawImage"; readonly args: readonly unknown[] }
  | {
      readonly kind: "arc";
      readonly x: number;
      readonly y: number;
      readonly radius: number;
    }
  | { readonly kind: "fill"; readonly fillStyle: string }
  | { readonly kind: "fillStyle"; readonly value: string };

interface FakeCanvasHandle {
  readonly canvas: HTMLCanvasElement;
  readonly calls: DrawCall[];
  readonly getContextArgs: string[];
  readonly toDataUrlArgs: string[];
}

function createFakeCanvas(hasContext: boolean): FakeCanvasHandle {
  const calls: DrawCall[] = [];
  const getContextArgs: string[] = [];
  const toDataUrlArgs: string[] = [];
  let currentFillStyle = "";
  const fakeContext = {
    drawImage: (...args: unknown[]) => {
      calls.push({ kind: "drawImage", args });
    },
    beginPath: () => {},
    closePath: () => {},
    arc: (x: number, y: number, radius: number) => {
      calls.push({ kind: "arc", x, y, radius });
    },
    fill: () => {
      calls.push({ kind: "fill", fillStyle: currentFillStyle });
    },
    get fillStyle() {
      return currentFillStyle;
    },
    set fillStyle(value: string) {
      currentFillStyle = value;
      calls.push({ kind: "fillStyle", value });
    },
  };
  const canvas = document.createElement("canvas");
  Object.defineProperty(canvas, "getContext", {
    value: (contextId: string) => {
      getContextArgs.push(contextId);
      return hasContext ? fakeContext : null;
    },
  });
  Object.defineProperty(canvas, "toDataURL", {
    value: (mimeType: string) => {
      toDataUrlArgs.push(mimeType);
      return FRAME_DATA_URL;
    },
  });
  return { canvas, calls, getContextArgs, toDataUrlArgs };
}

function appendIconLink(rel: string, href: string, type?: string) {
  const link = document.createElement("link");
  link.setAttribute("rel", rel);
  link.setAttribute("href", href);
  if (type !== undefined) link.setAttribute("type", type);
  document.head.appendChild(link);
  return link;
}

class FakeImage {
  static instances: FakeImage[] = [];
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  src = "";
  constructor() {
    FakeImage.instances.push(this);
  }
}

beforeEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
});

afterEach(() => {
  restoreFaviconHref();
  document.head.innerHTML = "";
  document.body.innerHTML = "";
});

describe("renderFaviconFrame", () => {
  it("draws the base image, then a white ring, then the colored dot and returns the data URL", () => {
    const fake = createFakeCanvas(true);
    const baseImage = document.createElement("img");

    const result = renderFaviconFrame(baseImage, "#ef4444", () => fake.canvas);

    expect(result).toBe(FRAME_DATA_URL);
    expect(fake.canvas.width).toBe(64);
    expect(fake.canvas.height).toBe(64);
    expect(fake.getContextArgs).toEqual(["2d"]);
    expect(fake.toDataUrlArgs).toEqual(["image/png"]);
    const drawIndex = fake.calls.findIndex((call) => call.kind === "drawImage");
    expect(fake.calls[drawIndex]).toEqual({
      kind: "drawImage",
      args: [baseImage, 0, 0, 64, 64],
    });
    const arcs = fake.calls.filter((call) => call.kind === "arc");
    expect(arcs).toEqual([
      { kind: "arc", x: 46, y: 18, radius: 16 },
      { kind: "arc", x: 46, y: 18, radius: 12 },
    ]);
    const fills = fake.calls.filter((call) => call.kind === "fill");
    expect(fills).toEqual([
      { kind: "fill", fillStyle: "#ffffff" },
      { kind: "fill", fillStyle: "#ef4444" },
    ]);
    const firstArcIndex = fake.calls.findIndex((call) => call.kind === "arc");
    expect(drawIndex).toBeLessThan(firstArcIndex);
  });

  it("draws no arcs when dotColor is null", () => {
    const fake = createFakeCanvas(true);

    const result = renderFaviconFrame(
      document.createElement("img"),
      null,
      () => fake.canvas,
    );

    expect(result).toBe(FRAME_DATA_URL);
    expect(fake.calls.filter((call) => call.kind === "arc")).toEqual([]);
    expect(fake.calls.filter((call) => call.kind === "drawImage")).toHaveLength(
      1,
    );
  });

  it("returns null when the 2D context is unavailable", () => {
    const fake = createFakeCanvas(false);

    const result = renderFaviconFrame(
      document.createElement("img"),
      "#ef4444",
      () => fake.canvas,
    );

    expect(result).toBeNull();
    expect(fake.toDataUrlArgs).toEqual([]);
  });
});

describe("applyFaviconHref / restoreFaviconHref", () => {
  it("sets href and png type on an existing icon link and restores both exactly", () => {
    const link = appendIconLink("icon", NEXT_ICON_HREF, "image/x-icon");

    applyFaviconHref(FRAME_DATA_URL);

    expect(link.getAttribute("href")).toBe(FRAME_DATA_URL);
    expect(link.getAttribute("type")).toBe("image/png");

    restoreFaviconHref();

    expect(link.getAttribute("href")).toBe(NEXT_ICON_HREF);
    expect(link.getAttribute("type")).toBe("image/x-icon");
    expect(link.isConnected).toBe(true);
  });

  it("records the original attributes only once when applied twice", () => {
    const link = appendIconLink("icon", NEXT_ICON_HREF, "image/x-icon");

    applyFaviconHref(FRAME_DATA_URL);
    applyFaviconHref("data:image/png;base64,SECOND");
    restoreFaviconHref();

    expect(link.getAttribute("href")).toBe(NEXT_ICON_HREF);
    expect(link.getAttribute("type")).toBe("image/x-icon");
  });

  it("removes the type attribute on restore when the original had none", () => {
    const link = appendIconLink("icon", NEXT_ICON_HREF);

    applyFaviconHref(FRAME_DATA_URL);
    restoreFaviconHref();

    expect(link.getAttribute("href")).toBe(NEXT_ICON_HREF);
    expect(link.hasAttribute("type")).toBe(false);
  });

  it("creates a status link when no icon links exist and removes it on restore", () => {
    applyFaviconHref(FRAME_DATA_URL);

    const createdLink = document.head.querySelector<HTMLLinkElement>(
      'link[data-devhub-status-favicon="true"]',
    );
    expect(createdLink).not.toBeNull();
    expect(createdLink?.getAttribute("rel")).toBe("icon");
    expect(createdLink?.getAttribute("type")).toBe("image/png");
    expect(createdLink?.getAttribute("href")).toBe(FRAME_DATA_URL);

    restoreFaviconHref();

    expect(document.querySelectorAll('link[rel~="icon"]')).toHaveLength(0);
  });

  it("handles shortcut icon links via rel~=icon", () => {
    const link = appendIconLink(
      "shortcut icon",
      NEXT_ICON_HREF,
      "image/x-icon",
    );

    applyFaviconHref(FRAME_DATA_URL);

    expect(link.getAttribute("href")).toBe(FRAME_DATA_URL);
    expect(
      document.head.querySelector('link[data-devhub-status-favicon="true"]'),
    ).toBeNull();

    restoreFaviconHref();

    expect(link.getAttribute("href")).toBe(NEXT_ICON_HREF);
  });

  it("updates icon links outside the head", () => {
    const bodyLink = document.createElement("link");
    bodyLink.setAttribute("rel", "icon");
    bodyLink.setAttribute("href", NEXT_ICON_HREF);
    document.body.appendChild(bodyLink);

    applyFaviconHref(FRAME_DATA_URL);

    expect(bodyLink.getAttribute("href")).toBe(FRAME_DATA_URL);
    expect(
      document.head.querySelector('link[data-devhub-status-favicon="true"]'),
    ).toBeNull();
  });
});

describe("isFaviconHrefApplied", () => {
  it("returns false when there are no icon links", () => {
    expect(isFaviconHrefApplied(FRAME_DATA_URL)).toBe(false);
  });

  it("returns true only when every icon link carries the data URL", () => {
    appendIconLink("icon", FRAME_DATA_URL);
    appendIconLink("shortcut icon", NEXT_ICON_HREF);

    expect(isFaviconHrefApplied(FRAME_DATA_URL)).toBe(false);

    applyFaviconHref(FRAME_DATA_URL);

    expect(isFaviconHrefApplied(FRAME_DATA_URL)).toBe(true);
    expect(isFaviconHrefApplied("data:image/png;base64,OTHER")).toBe(false);
  });
});

describe("loadFaviconBaseImage", () => {
  beforeEach(() => {
    FakeImage.instances = [];
    vi.stubGlobal("Image", FakeImage);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("resolves the image when it loads", async () => {
    const loadPromise = loadFaviconBaseImage();
    const image = FakeImage.instances[0];

    expect(image?.src).toBe(FAVICON_BASE_HREF);
    image?.onload?.();

    await expect(loadPromise).resolves.toBe(image);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("resolves null when the image errors", async () => {
    const loadPromise = loadFaviconBaseImage("/custom.png");
    const image = FakeImage.instances[0];

    expect(image?.src).toBe("/custom.png");
    image?.onerror?.();

    await expect(loadPromise).resolves.toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("resolves null after the load timeout", async () => {
    const loadPromise = loadFaviconBaseImage();

    vi.advanceTimersByTime(FAVICON_IMAGE_LOAD_TIMEOUT_MS - 1);
    let settledValue: HTMLImageElement | null | "pending" = "pending";
    void loadPromise.then((value) => {
      settledValue = value;
    });
    await Promise.resolve();
    expect(settledValue).toBe("pending");

    vi.advanceTimersByTime(1);

    await expect(loadPromise).resolves.toBeNull();
  });
});
