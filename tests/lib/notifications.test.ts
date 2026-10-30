import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  closeAllBrowserNotifications,
  navigateToNotificationTarget,
  setNotificationNavigator,
  showBrowserNotification,
  updatePushNotificationEnabled,
  type BrowserNotificationContent,
} from "@/lib/notifications";

class FakeNotification {
  static permission: NotificationPermission = "granted";
  static requestPermission = vi.fn(
    (): Promise<NotificationPermission> => Promise.resolve("granted"),
  );
  static instances: FakeNotification[] = [];
  static shouldThrowOnConstruct = false;

  readonly title: string;
  readonly options: NotificationOptions & { renotify?: boolean };
  readonly close = vi.fn(() => {
    this.onclose?.();
  });
  onclick: (() => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(
    title: string,
    options: NotificationOptions & { renotify?: boolean },
  ) {
    if (FakeNotification.shouldThrowOnConstruct) {
      throw new TypeError("Illegal constructor");
    }
    this.title = title;
    this.options = options;
    FakeNotification.instances.push(this);
  }
}

function buildContent(
  overrides: Partial<BrowserNotificationContent> = {},
): BrowserNotificationContent {
  return {
    title: "Approval needed: Fix login bug",
    body: "dev-hub - wants to run: pnpm test",
    tag: "devhub:permission:ws-1:perm-1",
    targetHref: "/chat?workspaceId=ws-1&sessionId=ses-root",
    ...overrides,
  };
}

function getInstance(index: number): FakeNotification {
  const instance = FakeNotification.instances[index];
  if (!instance) throw new Error(`No notification instance at ${index}`);
  return instance;
}

describe("showBrowserNotification", () => {
  beforeEach(() => {
    FakeNotification.permission = "granted";
    FakeNotification.requestPermission = vi.fn(
      (): Promise<NotificationPermission> => Promise.resolve("granted"),
    );
    FakeNotification.instances = [];
    FakeNotification.shouldThrowOnConstruct = false;
    vi.stubGlobal("Notification", FakeNotification);
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
  });

  afterEach(() => {
    closeAllBrowserNotifications();
    setNotificationNavigator(null);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("creates a notification with exact title, body, tag, renotify and icon when permission is granted", () => {
    const content = buildContent();

    showBrowserNotification(content);

    expect(FakeNotification.instances).toHaveLength(1);
    const notification = getInstance(0);
    expect(notification.title).toBe(content.title);
    expect(notification.options).toEqual({
      body: content.body,
      tag: content.tag,
      renotify: true,
      icon: "/favicon.ico",
    });
  });

  it("skips the notification when the document has focus", () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);

    showBrowserNotification(buildContent());

    expect(FakeNotification.instances).toHaveLength(0);
  });

  it("skips the notification when push notifications are disabled", () => {
    updatePushNotificationEnabled(false);
    try {
      showBrowserNotification(buildContent());

      expect(FakeNotification.instances).toHaveLength(0);
    } finally {
      updatePushNotificationEnabled(true);
    }
  });

  it("closes the previous instance once and tracks only the second when the same tag is shown twice", () => {
    showBrowserNotification(buildContent({ body: "first" }));
    showBrowserNotification(buildContent({ body: "second" }));

    const firstNotification = getInstance(0);
    const secondNotification = getInstance(1);
    expect(firstNotification.close).toHaveBeenCalledTimes(1);
    expect(secondNotification.close).not.toHaveBeenCalled();

    closeAllBrowserNotifications();

    expect(firstNotification.close).toHaveBeenCalledTimes(1);
    expect(secondNotification.close).toHaveBeenCalledTimes(1);
  });

  it("does not let a constructor exception escape", () => {
    FakeNotification.shouldThrowOnConstruct = true;

    expect(() => showBrowserNotification(buildContent())).not.toThrow();
    expect(FakeNotification.instances).toHaveLength(0);
  });

  it("focuses the window, closes the notification and navigates to the target on click", () => {
    const navigator = vi.fn();
    setNotificationNavigator(navigator);
    const focusSpy = vi.spyOn(window, "focus").mockImplementation(() => {});
    const content = buildContent();
    showBrowserNotification(content);
    const notification = getInstance(0);

    notification.onclick?.();

    expect(focusSpy).toHaveBeenCalledTimes(1);
    expect(notification.close).toHaveBeenCalledTimes(1);
    expect(navigator).toHaveBeenCalledWith(content.targetHref);
  });

  it("forgets a clicked notification so closing all does not close it again", () => {
    setNotificationNavigator(vi.fn());
    vi.spyOn(window, "focus").mockImplementation(() => {});
    showBrowserNotification(buildContent());
    const notification = getInstance(0);
    notification.onclick?.();

    closeAllBrowserNotifications();

    expect(notification.close).toHaveBeenCalledTimes(1);
  });

  it("keeps tracking the newer instance when a replaced instance fires onclose late", () => {
    showBrowserNotification(buildContent({ body: "first" }));
    showBrowserNotification(buildContent({ body: "second" }));
    const firstNotification = getInstance(0);
    const secondNotification = getInstance(1);

    firstNotification.onclose?.();
    closeAllBrowserNotifications();

    expect(secondNotification.close).toHaveBeenCalledTimes(1);
  });

  it("requests permission and creates the notification when permission is default and the request is granted", async () => {
    FakeNotification.permission = "default";

    showBrowserNotification(buildContent());
    await FakeNotification.requestPermission.mock.results[0]?.value;

    expect(FakeNotification.requestPermission).toHaveBeenCalledTimes(1);
    expect(FakeNotification.instances).toHaveLength(1);
  });

  it("swallows a rejected permission request", async () => {
    FakeNotification.permission = "default";
    const rejection = Promise.reject(new Error("blocked"));
    rejection.catch(() => {});
    FakeNotification.requestPermission = vi.fn(() => rejection);

    showBrowserNotification(buildContent());
    await rejection.catch(() => {});
    await Promise.resolve();

    expect(FakeNotification.instances).toHaveLength(0);
  });

  it("creates nothing when permission is denied", () => {
    FakeNotification.permission = "denied";

    showBrowserNotification(buildContent());

    expect(FakeNotification.requestPermission).not.toHaveBeenCalled();
    expect(FakeNotification.instances).toHaveLength(0);
  });

  it("closes the oldest notification when more than 50 distinct tags are open", () => {
    for (let index = 0; index < 51; index += 1) {
      showBrowserNotification(buildContent({ tag: `devhub:tag-${index}` }));
    }

    expect(getInstance(0).close).toHaveBeenCalledTimes(1);
    expect(getInstance(1).close).not.toHaveBeenCalled();
    expect(getInstance(50).close).not.toHaveBeenCalled();
  });
});

describe("navigateToNotificationTarget", () => {
  afterEach(() => {
    setNotificationNavigator(null);
  });

  it("falls back to assigning the location when no navigator is registered", () => {
    const assignSpy = vi.fn();

    navigateToNotificationTarget("/chat?sessionId=ses-1", assignSpy);

    expect(assignSpy).toHaveBeenCalledWith("/chat?sessionId=ses-1");
  });

  it("calls only the registered navigator when one is set", () => {
    const navigator = vi.fn();
    const assignSpy = vi.fn();
    setNotificationNavigator(navigator);

    navigateToNotificationTarget("/chat?sessionId=ses-1", assignSpy);

    expect(navigator).toHaveBeenCalledWith("/chat?sessionId=ses-1");
    expect(assignSpy).not.toHaveBeenCalled();
  });
});
