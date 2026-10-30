export const FAVICON_BASE_HREF = "/favicon.ico";
export const FAVICON_CANVAS_SIZE = 64;
export const FAVICON_DOT = {
  centerX: 46,
  centerY: 18,
  ringRadius: 16,
  dotRadius: 12,
} as const;
export const FAVICON_IMAGE_LOAD_TIMEOUT_MS = 5000;

const FAVICON_RING_COLOR = "#ffffff";
const FAVICON_MIME_TYPE = "image/png";
const ICON_LINK_SELECTOR = 'link[rel~="icon"]';

interface IconLinkAttributes {
  readonly href: string | null;
  readonly type: string | null;
}

const originalIconAttributes = new Map<HTMLLinkElement, IconLinkAttributes>();
const createdIconLinks = new Set<HTMLLinkElement>();

export function loadFaviconBaseImage(
  href: string = FAVICON_BASE_HREF,
): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    let isSettled = false;
    const settle = (result: HTMLImageElement | null) => {
      if (isSettled) return;
      isSettled = true;
      clearTimeout(timeoutId);
      image.onload = null;
      image.onerror = null;
      resolve(result);
    };
    const timeoutId = setTimeout(
      () => settle(null),
      FAVICON_IMAGE_LOAD_TIMEOUT_MS,
    );
    image.onload = () => settle(image);
    image.onerror = () => settle(null);
    image.src = href;
  });
}

function fillCircle(
  context: CanvasRenderingContext2D,
  radius: number,
  color: string,
) {
  context.beginPath();
  context.arc(FAVICON_DOT.centerX, FAVICON_DOT.centerY, radius, 0, Math.PI * 2);
  context.fillStyle = color;
  context.fill();
}

export function renderFaviconFrame(
  baseImage: CanvasImageSource,
  dotColor: string | null,
  createCanvas: () => HTMLCanvasElement = () =>
    document.createElement("canvas"),
): string | null {
  const canvas = createCanvas();
  canvas.width = FAVICON_CANVAS_SIZE;
  canvas.height = FAVICON_CANVAS_SIZE;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.drawImage(baseImage, 0, 0, FAVICON_CANVAS_SIZE, FAVICON_CANVAS_SIZE);
  if (dotColor) {
    fillCircle(context, FAVICON_DOT.ringRadius, FAVICON_RING_COLOR);
    fillCircle(context, FAVICON_DOT.dotRadius, dotColor);
  }
  return canvas.toDataURL(FAVICON_MIME_TYPE);
}

function queryIconLinks(): HTMLLinkElement[] {
  return Array.from(
    document.querySelectorAll<HTMLLinkElement>(ICON_LINK_SELECTOR),
  );
}

function createStatusIconLink(): HTMLLinkElement {
  const link = document.createElement("link");
  link.setAttribute("rel", "icon");
  link.setAttribute("type", FAVICON_MIME_TYPE);
  link.setAttribute("data-devhub-status-favicon", "true");
  document.head.appendChild(link);
  createdIconLinks.add(link);
  return link;
}

export function applyFaviconHref(dataUrl: string): void {
  const existingLinks = queryIconLinks();
  const links =
    existingLinks.length > 0 ? existingLinks : [createStatusIconLink()];
  for (const link of links) {
    const isTracked =
      originalIconAttributes.has(link) || createdIconLinks.has(link);
    if (!isTracked) {
      originalIconAttributes.set(link, {
        href: link.getAttribute("href"),
        type: link.getAttribute("type"),
      });
    }
    if (link.getAttribute("href") !== dataUrl) {
      link.setAttribute("href", dataUrl);
    }
    if (link.getAttribute("type") !== FAVICON_MIME_TYPE) {
      link.setAttribute("type", FAVICON_MIME_TYPE);
    }
  }
}

function restoreAttribute(
  link: HTMLLinkElement,
  attributeName: "href" | "type",
  originalValue: string | null,
) {
  if (originalValue === null) {
    link.removeAttribute(attributeName);
  } else {
    link.setAttribute(attributeName, originalValue);
  }
}

export function restoreFaviconHref(): void {
  for (const [link, original] of originalIconAttributes) {
    restoreAttribute(link, "href", original.href);
    restoreAttribute(link, "type", original.type);
  }
  originalIconAttributes.clear();
  for (const link of createdIconLinks) {
    link.remove();
  }
  createdIconLinks.clear();
}

export function isFaviconHrefApplied(dataUrl: string): boolean {
  const links = queryIconLinks();
  return (
    links.length > 0 &&
    links.every((link) => link.getAttribute("href") === dataUrl)
  );
}
